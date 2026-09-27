import {
  Binary,
  BSONRegExp,
  Code,
  DBRef,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
} from "bson";
import type { UuidRepresentation } from "../../api/client";

/**
 * Parse mongo-shell literal syntax — the text the "MongoDB Shell Format" view
 * renders — into BSON runtime values:
 *
 *   { "_id" : ObjectId("…"), price: Decimal128("1.5"), at: ISODate("…") }
 *
 * A small recursive-descent parser rather than `eval`: the editor content is
 * user data and must never execute. Accepts quoted or bare keys, single or
 * double quoted strings, comments, trailing commas, regex literals, the
 * optional `new` keyword, and both legacy (`NumberLong`, `BinData`) and mongosh
 * (`Long`, `Binary.createFromBase64`) constructor spellings.
 *
 * Numbers follow the shell display convention: an integer literal that fits
 * in 32 bits becomes Int32, a larger one Long (as canonical EJSON parsing
 * would), and anything with a decimal point / exponent Double.
 */
export const parseShellDocument = (
  text: string,
  uuidRepresentation: UuidRepresentation = "standard",
): unknown => {
  const p = new Parser(text, uuidRepresentation);
  const value = p.parseValue();
  p.expectEnd();
  return value;
};

export class ShellParseError extends Error {
  constructor(message: string, text: string, pos: number) {
    const before = text.slice(0, pos);
    const line = before.split("\n").length;
    const col = pos - before.lastIndexOf("\n");
    super(`${message} (line ${line}, column ${col})`);
    this.name = "ShellParseError";
  }
}

type Token =
  | { kind: "punct"; value: string; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "number"; value: string; pos: number }
  | { kind: "ident"; value: string; pos: number }
  | { kind: "regex"; pattern: string; flags: string; pos: number }
  | { kind: "eof"; pos: number };

const PUNCT = new Set(["{", "}", "[", "]", "(", ")", ",", ":", "."]);
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

class Parser {
  private pos = 0;
  private peeked: Token | null = null;

  constructor(
    private readonly src: string,
    private readonly rep: UuidRepresentation,
  ) {}

  // ── Lexer ───────────────────────────────────────────────────────────────

  private fail(message: string, pos = this.pos): never {
    throw new ShellParseError(message, this.src, pos);
  }

  private skipTrivia() {
    const s = this.src;
    while (this.pos < s.length) {
      const c = s[this.pos]!;
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿") {
        this.pos++;
      } else if (c === "/" && s[this.pos + 1] === "/") {
        const nl = s.indexOf("\n", this.pos);
        this.pos = nl === -1 ? s.length : nl + 1;
      } else if (c === "/" && s[this.pos + 1] === "*") {
        const end = s.indexOf("*/", this.pos + 2);
        if (end === -1) this.fail("Unterminated comment");
        this.pos = end + 2;
      } else {
        break;
      }
    }
  }

  private peek(): Token {
    if (!this.peeked) this.peeked = this.lex();
    return this.peeked;
  }

  private next(): Token {
    const t = this.peek();
    this.peeked = null;
    return t;
  }

  private lex(): Token {
    this.skipTrivia();
    const s = this.src;
    const start = this.pos;
    if (start >= s.length) return { kind: "eof", pos: start };
    const c = s[start]!;

    if (c === '"' || c === "'") return this.lexString(c);

    // A `/` in value position starts a regex literal (division never occurs
    // in a document literal).
    if (c === "/") return this.lexRegex();

    if (/[0-9]/.test(c) || ((c === "-" || c === "+" || c === ".") && /[0-9.]/.test(s[start + 1] ?? ""))) {
      const m = /^[-+]?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)/.exec(s.slice(start));
      if (!m) this.fail("Invalid number");
      this.pos += m[0].length;
      return { kind: "number", value: m[0], pos: start };
    }

    if ((c === "-" || c === "+") && s.startsWith("Infinity", start + 1)) {
      this.pos += 9;
      return { kind: "number", value: s.slice(start, this.pos), pos: start };
    }

    if (IDENT_START.test(c)) {
      let end = start + 1;
      while (end < s.length && IDENT_PART.test(s[end]!)) end++;
      this.pos = end;
      return { kind: "ident", value: s.slice(start, end), pos: start };
    }

    if (PUNCT.has(c)) {
      this.pos++;
      return { kind: "punct", value: c, pos: start };
    }

    this.fail(`Unexpected character '${c}'`);
  }

  private lexString(quote: string): Token {
    const s = this.src;
    const start = this.pos;
    let i = start + 1;
    let out = "";
    while (i < s.length) {
      const c = s[i]!;
      if (c === quote) {
        this.pos = i + 1;
        return { kind: "string", value: out, pos: start };
      }
      if (c === "\n") break;
      if (c !== "\\") {
        out += c;
        i++;
        continue;
      }
      const e = s[i + 1];
      i += 2;
      switch (e) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "v": out += "\v"; break;
        case "0": out += "\0"; break;
        case "\n": break; // line continuation
        case "x": {
          const hex = s.slice(i, i + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.fail("Invalid \\x escape", i);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
          break;
        }
        case "u": {
          let hex: string;
          if (s[i] === "{") {
            const close = s.indexOf("}", i);
            if (close === -1) this.fail("Invalid \\u escape", i);
            hex = s.slice(i + 1, close);
            i = close + 1;
          } else {
            hex = s.slice(i, i + 4);
            i += 4;
          }
          if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) this.fail("Invalid \\u escape", i);
          out += String.fromCodePoint(parseInt(hex, 16));
          break;
        }
        case undefined:
          return this.fail("Unterminated string", start);
        default:
          out += e;
      }
    }
    this.fail("Unterminated string", start);
  }

  private lexRegex(): Token {
    const s = this.src;
    const start = this.pos;
    let i = start + 1;
    let inClass = false;
    while (i < s.length) {
      const c = s[i]!;
      if (c === "\n") break;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        const pattern = s.slice(start + 1, i);
        let end = i + 1;
        while (end < s.length && /[a-z]/i.test(s[end]!)) end++;
        this.pos = end;
        return { kind: "regex", pattern, flags: s.slice(i + 1, end), pos: start };
      }
      i++;
    }
    this.fail("Unterminated regular expression", start);
  }

  // ── Grammar ─────────────────────────────────────────────────────────────

  expectEnd() {
    const t = this.peek();
    if (t.kind !== "eof") this.fail("Unexpected content after the value", t.pos);
  }

  private expectPunct(value: string): Token {
    const t = this.next();
    if (t.kind !== "punct" || t.value !== value) {
      this.fail(`Expected '${value}'`, t.pos);
    }
    return t;
  }

  private isPunct(value: string): boolean {
    const t = this.peek();
    return t.kind === "punct" && t.value === value;
  }

  parseValue(): unknown {
    const t = this.next();
    switch (t.kind) {
      case "string":
        return t.value;
      case "number":
        return toNumber(t.value);
      case "regex":
        try {
          return new BSONRegExp(unescapeSlashes(t.pattern), t.flags);
        } catch (e) {
          return this.fail(e instanceof Error ? e.message : String(e), t.pos);
        }
      case "punct":
        if (t.value === "{") return this.parseObjectBody();
        if (t.value === "[") return this.parseArrayBody();
        return this.fail(`Unexpected '${t.value}'`, t.pos);
      case "ident":
        return this.parseIdentifier(t);
      case "eof":
        return this.fail("Unexpected end of input", t.pos);
    }
  }

  private parseObjectBody(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    while (!this.isPunct("}")) {
      const k = this.next();
      let key: string;
      if (k.kind === "string" || k.kind === "ident") key = k.value;
      else if (k.kind === "number") key = String(Number(k.value));
      else return this.fail("Expected a field name", k.pos);
      this.expectPunct(":");
      out[key] = this.parseValue();
      if (!this.isPunct(",")) break;
      this.next();
    }
    this.expectPunct("}");
    return out;
  }

  private parseArrayBody(): unknown[] {
    const out: unknown[] = [];
    while (!this.isPunct("]")) {
      out.push(this.parseValue());
      if (!this.isPunct(",")) break;
      this.next();
    }
    this.expectPunct("]");
    return out;
  }

  private parseIdentifier(first: Token & { kind: "ident" }): unknown {
    let name = first.value;
    if (name === "new") {
      const t = this.next();
      if (t.kind !== "ident") this.fail("Expected a constructor after 'new'", t.pos);
      name = t.value;
    }
    while (this.isPunct(".")) {
      this.next();
      const t = this.next();
      if (t.kind !== "ident") this.fail("Expected a name after '.'", t.pos);
      name += `.${t.value}`;
    }

    if (!this.isPunct("(")) {
      switch (name) {
        case "true": return true;
        case "false": return false;
        case "null": return null;
        case "undefined": return undefined;
        case "Infinity": return new Double(Infinity);
        case "NaN": return new Double(NaN);
        case "MinKey": return new MinKey();
        case "MaxKey": return new MaxKey();
      }
      this.fail(`Unknown identifier '${name}'`, first.pos);
    }

    this.next(); // (
    const args: unknown[] = [];
    while (!this.isPunct(")")) {
      args.push(this.parseValue());
      if (!this.isPunct(",")) break;
      this.next();
    }
    this.expectPunct(")");
    try {
      return this.construct(name, args);
    } catch (e) {
      if (e instanceof ShellParseError) throw e;
      this.fail(`${name}(): ${e instanceof Error ? e.message : String(e)}`, first.pos);
    }
  }

  private construct(name: string, args: unknown[]): unknown {
    const [a, b] = args;
    switch (name) {
      case "ObjectId":
      case "ObjectID":
        return a === undefined ? new ObjectId() : new ObjectId(str(a));
      case "ISODate":
      case "Date": {
        if (a === undefined) return new Date();
        const d = new Date(typeof a === "string" ? a : num(a));
        if (Number.isNaN(d.getTime())) throw new Error(`invalid date '${String(a)}'`);
        return d;
      }
      case "NumberInt":
      case "Int32":
        return new Int32(num(a ?? 0));
      case "NumberLong":
      case "Long":
        return Long.fromString(str(a ?? "0"));
      case "NumberDecimal":
      case "Decimal128":
        return Decimal128.fromString(str(a ?? "0"));
      case "NumberDouble":
      case "Double":
        return new Double(num(a ?? 0));
      case "UUID":
        return a === undefined
          ? new Binary(randomUuidBytes(), Binary.SUBTYPE_UUID)
          : new Binary(uuidBytes(str(a)), Binary.SUBTYPE_UUID);
      case "CSUUID":
        return legacyUuid(str(a), "csharpLegacy");
      case "JUUID":
        return legacyUuid(str(a), "javaLegacy");
      case "PYUUID":
        return legacyUuid(str(a), "pythonLegacy");
      case "LUUID":
        return legacyUuid(str(a), this.rep);
      case "BinData":
        return Binary.createFromBase64(str(b), num(a));
      case "HexData":
        return Binary.createFromHexString(str(b), num(a));
      case "Binary.createFromBase64":
        return Binary.createFromBase64(str(a), b === undefined ? 0 : num(b));
      case "Binary.createFromHexString":
        return Binary.createFromHexString(str(a), b === undefined ? 0 : num(b));
      case "Timestamp": {
        if (a && typeof a === "object" && !isBson(a)) {
          const o = a as { t?: unknown; i?: unknown };
          return new Timestamp({ t: num(o.t ?? 0), i: num(o.i ?? 0) });
        }
        return new Timestamp({ t: num(a ?? 0), i: num(b ?? 0) });
      }
      case "MinKey":
        return new MinKey();
      case "MaxKey":
        return new MaxKey();
      case "RegExp":
      case "BSONRegExp":
        return new BSONRegExp(str(a), b === undefined ? "" : str(b));
      case "Code":
        return new Code(str(a));
      case "DBRef":
        return new DBRef(str(a), b as ObjectId, args[2] === undefined ? undefined : str(args[2]));
      default:
        throw new Error("unknown constructor");
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** `\/` is only needed inside a JS regex literal; Mongo stores a bare `/`. */
const unescapeSlashes = (pattern: string): string => {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\" && pattern[i + 1] === "/") continue;
    if (c === "\\") {
      out += c + (pattern[i + 1] ?? "");
      i++;
      continue;
    }
    out += c;
  }
  return out;
};

const isBson = (v: unknown): boolean =>
  !!v && typeof v === "object" && "_bsontype" in (v as object);

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

const toNumber = (lit: string): Int32 | Long | Double => {
  if (/Infinity$/.test(lit)) {
    return new Double(lit.startsWith("-") ? -Infinity : Infinity);
  }
  const unsigned = lit.replace(/^[-+]/, "");
  const n = /^0[xX]/.test(unsigned)
    ? (lit.startsWith("-") ? -1 : 1) * parseInt(unsigned, 16)
    : Number(lit);
  const integral = !/[.eE]/.test(unsigned) || /^0[xX]/.test(unsigned);
  if (integral && Number.isInteger(n) && n >= INT32_MIN && n <= INT32_MAX && !Object.is(n, -0)) {
    return new Int32(n);
  }
  if (integral && !/^0[xX]/.test(unsigned) && !Object.is(n, -0)) {
    // Parse the literal text, not `n`, so digits past 2^53 aren't rounded.
    const big = BigInt(lit.replace(/^\+/, ""));
    if (big >= INT64_MIN && big <= INT64_MAX) return Long.fromBigInt(big);
  }
  return new Double(n);
};

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (v instanceof Int32 || v instanceof Double) return v.valueOf();
  if (v instanceof Long) return v.toNumber();
  throw new Error(`expected a number, got ${JSON.stringify(v)}`);
};

const str = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v instanceof Int32 || v instanceof Double) return String(v.valueOf());
  throw new Error(`expected a string, got ${JSON.stringify(v)}`);
};

const uuidBytes = (s: string): Uint8Array => {
  const hex = s.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`invalid UUID '${s}'`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const randomUuidBytes = (): Uint8Array => uuidBytes(crypto.randomUUID());

/**
 * Subtype-3 legacy UUID: the displayed hex is the logical UUID, stored bytes
 * are in the driver's byte order. The C# / Java swaps are self-inverse, so the
 * same reorder that display uses turns display order back into storage order.
 */
const legacyUuid = (s: string, rep: UuidRepresentation): Binary => {
  const b = uuidBytes(s);
  let out = b;
  if (rep === "csharpLegacy") {
    out = new Uint8Array([b[3]!, b[2]!, b[1]!, b[0]!, b[5]!, b[4]!, b[7]!, b[6]!, ...b.subarray(8)]);
  } else if (rep === "javaLegacy") {
    out = new Uint8Array([...b.subarray(0, 8).reverse(), ...b.subarray(8).reverse()]);
  }
  return new Binary(out, Binary.SUBTYPE_UUID_OLD);
};
