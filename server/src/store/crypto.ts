import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

const decodeKey = (raw: string): Buffer => {
  // Support either base64 or hex; reject anything else.
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === KEY_LENGTH) return b64;
  } catch {
    /* fall through */
  }
  try {
    const hex = Buffer.from(raw, "hex");
    if (hex.length === KEY_LENGTH) return hex;
  } catch {
    /* fall through */
  }
  throw new Error(
    `Invalid MANGO_MASTER_KEY: must be 32 bytes encoded as base64 or hex (got ${raw.length} chars).`,
  );
};

let cachedKey: Buffer | null = null;

export const getMasterKey = (): Buffer => {
  if (cachedKey) return cachedKey;
  const raw = process.env.MANGO_MASTER_KEY;
  if (raw) {
    cachedKey = decodeKey(raw);
    return cachedKey;
  }
  // Generate an ephemeral key — only safe in dev. Warn loudly so prod ops
  // notice it in logs and configure a real one.
  cachedKey = randomBytes(KEY_LENGTH);
  console.warn(
    "[mango] MANGO_MASTER_KEY is not set — generated an ephemeral key for this process.\n" +
      "         Saved connections will be unreadable after restart.\n" +
      "         For persistence: export MANGO_MASTER_KEY=\"$(openssl rand -base64 32)\".",
  );
  return cachedKey;
};

/**
 * Encrypt a plaintext value with AES-256-GCM. Output format is base64 of:
 *   [iv (12 bytes) | tag (16 bytes) | ciphertext (var)]
 * which is portable and self-describing for decryption.
 */
export const encryptString = (plaintext: string): string => {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
};

export const decryptString = (encoded: string): string => {
  const key = getMasterKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LENGTH + 16 + 1) {
    throw new Error("Ciphertext too short.");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buf.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
};

/**
 * Strip the password from a MongoDB URI for safe display.
 * mongodb://admin:secret@host:27017 → mongodb://admin:•••@host:27017
 */
export const redactUri = (uri: string): string => {
  try {
    const scheme = uri.match(/^mongodb(\+srv)?:\/\//i)?.[0];
    if (!scheme) return uri;
    const rest = uri.slice(scheme.length);
    const slashIndex = rest.search(/[/?#]/);
    const authority = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
    const suffix = slashIndex === -1 ? "" : rest.slice(slashIndex);
    const at = authority.lastIndexOf("@");
    if (at === -1) return uri;
    const userInfo = authority.slice(0, at);
    const hostInfo = authority.slice(at + 1);
    const colon = userInfo.indexOf(":");
    if (colon === -1) return uri;
    return `${scheme}${userInfo.slice(0, colon)}:***@${hostInfo}${suffix}`;
  } catch {
    return uri.replace(
      /^(mongodb(?:\+srv)?:\/\/)([^:@/\s]+):([^@/\s]+)@/i,
      "$1$2:***@",
    );
  }
};
