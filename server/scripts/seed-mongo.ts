// One-shot sample-data seeder for the Aspire-orchestrated dev mongo.
// Connects via MONGO_URL, drops + repopulates the two sample databases below,
// then exits. Wired in via apphost.ts as a `mango-seed` resource that
// `mango-server` waits-for-completion on.
//
// Goal: realistic data with type variety (ObjectId, Decimal128, Date, nested
// docs, arrays) so the Mango UI has something interesting to click through.

import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import {
  Binary,
  Decimal128,
  GridFSBucket,
  MongoClient,
  ObjectId,
  UUID,
} from "mongodb";

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("[seed] MONGO_URL is not set — aborting.");
  process.exit(1);
}

// Deterministic-ish PRNG so repeat runs produce similar shapes (helps when
// debugging the UI against known data). Not crypto, just a small LCG seeded
// off a constant.
let _s = 0xc0ffee;
const rand = (): number => {
  _s = (_s * 1664525 + 1013904223) & 0xffffffff;
  return ((_s >>> 0) / 0x1_0000_0000);
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const rangeInt = (lo: number, hi: number): number =>
  lo + Math.floor(rand() * (hi - lo + 1));
const daysAgo = (n: number): Date =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const FIRST_NAMES = [
  "Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Henry",
  "Iris", "Jack", "Karen", "Liam", "Maya", "Noah", "Olivia", "Peter",
  "Quinn", "Rachel", "Sam", "Tina", "Uma", "Victor", "Wendy", "Xavier",
  "Yara", "Zach",
] as const;
const LAST_NAMES = [
  "Anderson", "Brown", "Chen", "Davis", "Evans", "Foster", "Garcia",
  "Hassan", "Ivanov", "Jones", "Kim", "Lopez", "Martin", "Nguyen",
  "O'Brien", "Patel", "Quinn", "Reed", "Smith", "Tanaka", "Ueda",
  "Vargas", "Wang", "Xu", "Young", "Zhang",
] as const;

const PRODUCT_CATEGORIES = [
  "electronics", "books", "clothing", "home", "outdoors", "toys",
] as const;
const ORDER_STATUSES = [
  "pending", "paid", "shipped", "delivered", "cancelled", "refunded",
] as const;
const POST_TAGS = [
  "typescript", "mongodb", "react", "tooling", "design", "performance",
  "security", "testing", "devops", "rust",
] as const;

const fullName = (): { first: string; last: string } => ({
  first: pick(FIRST_NAMES),
  last: pick(LAST_NAMES),
});
const email = (first: string, last: string): string =>
  // Keep digits — callers append an index suffix to last for uniqueness, and
  // an earlier version of this helper was stripping the digits silently.
  `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sentence = (n: number): string => {
  const words = [
    "the", "quick", "lazy", "fox", "jumps", "over", "tiny", "dog",
    "mongo", "loves", "documents", "and", "binary", "json", "fields",
    "while", "queries", "run", "fast", "across", "indexes", "today",
  ];
  return Array.from({ length: n }, () => pick(words)).join(" ") + ".";
};

interface SeedUser {
  _id: ObjectId;
  email: string;
  name: { first: string; last: string };
  age: number;
  tags: string[];
  profile: { bio: string; verified: boolean; karma: number };
  createdAt: Date;
}

interface SeedProduct {
  _id: ObjectId;
  sku: string;
  name: string;
  category: (typeof PRODUCT_CATEGORIES)[number];
  price: Decimal128;
  stock: number;
  attributes: Record<string, string | number | boolean>;
  createdAt: Date;
}

interface SeedOrder {
  _id: ObjectId;
  userId: ObjectId;
  items: Array<{ productId: ObjectId; qty: number; unitPrice: Decimal128 }>;
  total: Decimal128;
  status: (typeof ORDER_STATUSES)[number];
  shippingAddress: { city: string; country: string; postalCode: string };
  placedAt: Date;
}

interface SeedPost {
  _id: ObjectId;
  authorId: ObjectId;
  title: string;
  slug: string;
  body: string;
  tags: string[];
  publishedAt: Date | null;
  views: number;
}

interface SeedComment {
  _id: ObjectId;
  postId: ObjectId;
  authorEmail: string;
  body: string;
  upvotes: number;
  createdAt: Date;
}

const buildUsers = (count: number): SeedUser[] =>
  // Suffix each email with the index so the unique-index seed doesn't trip on
  // collisions from our small first/last-name pool (birthday paradox kicks in
  // well below 50 users otherwise).
  Array.from({ length: count }, (_, i) => {
    const name = fullName();
    return {
      _id: new ObjectId(),
      email: email(name.first, `${name.last}${i + 1}`),
      name,
      age: rangeInt(18, 72),
      tags: Array.from(
        new Set(Array.from({ length: rangeInt(1, 3) }, () => pick(POST_TAGS))),
      ),
      profile: {
        bio: sentence(rangeInt(6, 14)),
        verified: rand() < 0.4,
        karma: rangeInt(-50, 5000),
      },
      createdAt: daysAgo(rangeInt(1, 720)),
    };
  });

const buildProducts = (count: number): SeedProduct[] =>
  Array.from({ length: count }, (_, i) => {
    const category = pick(PRODUCT_CATEGORIES);
    const cents = rangeInt(99, 49999);
    return {
      _id: new ObjectId(),
      sku: `${category.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(4, "0")}`,
      name: `${pick(["Classic", "Pro", "Mini", "Ultra", "Eco"])} ${pick(["Widget", "Gadget", "Reader", "Press", "Frame"])}`,
      category,
      price: Decimal128.fromString((cents / 100).toFixed(2)),
      stock: rangeInt(0, 250),
      attributes: {
        color: pick(["red", "black", "white", "blue", "silver"]),
        weightGrams: rangeInt(50, 2500),
        featured: rand() < 0.15,
      },
      createdAt: daysAgo(rangeInt(1, 365)),
    };
  });

const buildOrders = (
  count: number,
  users: SeedUser[],
  products: SeedProduct[],
): SeedOrder[] =>
  Array.from({ length: count }, () => {
    const user = pick(users);
    const itemCount = rangeInt(1, 4);
    const items = Array.from({ length: itemCount }, () => {
      const product = pick(products);
      return {
        productId: product._id,
        qty: rangeInt(1, 5),
        unitPrice: product.price,
      };
    });
    const totalCents = items.reduce(
      (acc, it) =>
        acc + Math.round(Number(it.unitPrice.toString()) * 100) * it.qty,
      0,
    );
    return {
      _id: new ObjectId(),
      userId: user._id,
      items,
      total: Decimal128.fromString((totalCents / 100).toFixed(2)),
      status: pick(ORDER_STATUSES),
      shippingAddress: {
        city: pick(["Berlin", "Paris", "Tokyo", "Austin", "Madrid", "Oslo"]),
        country: pick(["DE", "FR", "JP", "US", "ES", "NO"]),
        postalCode: randomBytes(2).toString("hex").toUpperCase(),
      },
      placedAt: daysAgo(rangeInt(0, 180)),
    };
  });

const buildPosts = (count: number, authors: SeedUser[]): SeedPost[] =>
  // Suffix slugs with the index for the same reason as user emails — the
  // {prefix × tag × suffix} title space is only ~160 combinations.
  Array.from({ length: count }, (_, i) => {
    const title = `${pick(["On", "About", "Notes on", "A Tour of"])} ${pick(POST_TAGS)} ${pick(["patterns", "tradeoffs", "wins", "pitfalls"])}`;
    const isPublished = rand() < 0.85;
    return {
      _id: new ObjectId(),
      authorId: pick(authors)._id,
      title,
      slug: `${slug(title)}-${i + 1}`,
      body: Array.from({ length: rangeInt(3, 8) }, () => sentence(rangeInt(8, 16))).join(" "),
      tags: Array.from(
        new Set(Array.from({ length: rangeInt(1, 4) }, () => pick(POST_TAGS))),
      ),
      publishedAt: isPublished ? daysAgo(rangeInt(0, 540)) : null,
      views: isPublished ? rangeInt(10, 25_000) : 0,
    };
  });

interface SeedPagingRow {
  _id: ObjectId;
  seq: number;
  label: string;
  even: boolean;
  createdAt: Date;
}

// Large fixed-size collection with a monotonic `seq` so the page-size /
// next-page / boundary behaviour is easy to eyeball — row 1 is always seq=1,
// seq maps 1:1 to a row number, so any page's contents are predictable.
const buildPagingRows = (count: number): SeedPagingRow[] =>
  Array.from({ length: count }, (_, i) => ({
    _id: new ObjectId(),
    seq: i + 1,
    label: `row-${String(i + 1).padStart(5, "0")}`,
    even: (i + 1) % 2 === 0,
    createdAt: daysAgo(rangeInt(0, 720)),
  }));

// ── UUID format sampling ──────────────────────────────────────────────────
// A MongoDB UUID is stored as a Binary. Subtype 4 is the modern, unambiguous
// "standard" encoding. Subtype 3 is a *legacy* UUID whose on-disk byte order
// depends on the driver that wrote it — the C#, Java and Python legacy drivers
// each scramble the bytes differently, so the same logical UUID reads as three
// different hex strings unless the viewer knows which representation to apply.
//
// This collection stores a handful of fixed canonical UUIDs, each written out
// in *every* format, so the UI's UUID-representation switcher has something
// concrete to verify against: pick "C# legacy" and only the `csharpLegacy`
// rows should surface their `canonical` value; pick "standard" and only the
// subtype-4 rows should.

type UuidRep = "standard" | "csharpLegacy" | "javaLegacy" | "pythonLegacy";

const UUID_REPS: ReadonlyArray<{ rep: UuidRep; subType: 3 | 4; marker: string }> = [
  { rep: "standard", subType: 4, marker: "UUID" },
  { rep: "csharpLegacy", subType: 3, marker: "CSUUID" },
  { rep: "javaLegacy", subType: 3, marker: "JUUID" },
  { rep: "pythonLegacy", subType: 3, marker: "PYUUID" },
];

// Fixed canonical UUIDs (dash-separated hex) so repeat runs are eyeball-stable
// and the stored bytes can be checked against a known value. Mix of versions:
// a v7 (time-ordered), a classic v4, and an all-visible-nibbles pattern.
const CANONICAL_UUIDS = [
  "0193ade0-5f8e-7c3a-9b21-1f4c8e5a7d90",
  "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
] as const;

const uuidBytes = (canonical: string): Buffer =>
  Buffer.from(canonical.replace(/-/g, ""), "hex");

// Mirror of the UI's reorderBytesForRepresentation (ui/src/api/client.ts). The
// permutation is an involution, so the same function maps a canonical-order
// buffer to the on-disk bytes each legacy driver would have written.
const reorderForRep = (bytes: Buffer, rep: UuidRep): Buffer => {
  if (rep === "standard" || rep === "pythonLegacy") return Buffer.from(bytes);
  const out = Buffer.alloc(16);
  if (rep === "csharpLegacy") {
    out[0] = bytes[3]!;
    out[1] = bytes[2]!;
    out[2] = bytes[1]!;
    out[3] = bytes[0]!;
    out[4] = bytes[5]!;
    out[5] = bytes[4]!;
    out[6] = bytes[7]!;
    out[7] = bytes[6]!;
    bytes.copy(out, 8, 8, 16);
    return out;
  }
  // javaLegacy: reverse the two 8-byte halves independently.
  for (let i = 0; i < 8; i++) out[i] = bytes[7 - i]!;
  for (let i = 0; i < 8; i++) out[8 + i] = bytes[15 - i]!;
  return out;
};

// Build the Binary a driver using `rep` would persist for `canonical`.
const uuidBinary = (canonical: string, rep: UuidRep, subType: 3 | 4): Binary => {
  const disk = reorderForRep(uuidBytes(canonical), rep);
  return subType === 4 ? new UUID(disk).toBinary() : new Binary(disk, 3);
};

interface SeedUuidDoc {
  // Some rows are keyed by an ObjectId, some by the UUID itself, so the viewer
  // has to render both `_id` shapes (and legacy subtype-3 keys, which are the
  // trickiest to display correctly).
  _id: ObjectId | Binary;
  canonical: string;
  format: UuidRep;
  subType: 3 | 4;
  marker: string;
  value: Binary;
  createdAt: Date;
  note: string;
  // Only set on the nested-sample row — exercises the recursive display walk
  // over UUIDs held in arrays and sub-documents.
  siblings?: Binary[];
  related?: { primary: Binary; legacy: Binary };
}

const buildUuidDocs = (): SeedUuidDoc[] => {
  const docs: SeedUuidDoc[] = [];
  for (const canonical of CANONICAL_UUIDS) {
    for (const { rep, subType, marker } of UUID_REPS) {
      const value = uuidBinary(canonical, rep, subType);
      docs.push({
        // Key the standard-format rows by the UUID itself; the rest by
        // ObjectId — this keeps a subtype-4 UUID `_id` in the mix without
        // colliding on the shared canonical value.
        _id: subType === 4 ? value : new ObjectId(),
        canonical,
        format: rep,
        subType,
        marker,
        value,
        createdAt: daysAgo(rangeInt(0, 365)),
        note:
          subType === 4
            ? "Standard subtype-4 UUID — representation-independent."
            : `Legacy subtype-3 UUID as written by the ${rep} driver — only the "${marker}" representation decodes it back to \`canonical\`.`,
      });
    }
  }
  // One document exercising UUIDs nested in arrays / sub-documents, so the
  // read-only humanize walk is tested beyond top-level fields.
  const nestedCanonical = CANONICAL_UUIDS[0]!;
  docs.push({
    _id: new ObjectId(),
    canonical: nestedCanonical,
    format: "standard",
    subType: 4,
    marker: "UUID",
    value: uuidBinary(nestedCanonical, "standard", 4),
    createdAt: daysAgo(1),
    note: "Nested/array UUIDs — exercises the recursive display walk.",
    siblings: CANONICAL_UUIDS.map((c) => uuidBinary(c, "standard", 4)),
    related: {
      primary: uuidBinary(nestedCanonical, "standard", 4),
      legacy: uuidBinary(nestedCanonical, "csharpLegacy", 3),
    },
  });
  return docs;
};

const buildComments = (count: number, posts: SeedPost[]): SeedComment[] =>
  Array.from({ length: count }, () => {
    const post = pick(posts);
    const name = fullName();
    return {
      _id: new ObjectId(),
      postId: post._id,
      authorEmail: email(name.first, name.last),
      body: sentence(rangeInt(4, 18)),
      upvotes: rangeInt(0, 142),
      createdAt: daysAgo(rangeInt(0, 540)),
    };
  });

// Tiny 16x16 PNG (a yellow square with a darker outline) — base64-inlined so
// the seed has no runtime file dependencies. Renders fine in any browser.
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAR0lEQVR42mP8//8/Aw5gZGRk+I8L" +
  "MOIyBKsGFhYG/v//GRkYwOAk0AVAg0lJQAOAAYAATAYwI8EJYBhAFiBSJgYsAAEYAOQzD4Hl3aZRAAAAAElFTkSuQmCC";

// Tiny PDF (one blank page) — the smallest valid PDF that browsers will open.
const SAMPLE_PDF =
  "%PDF-1.1\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<<>>>>endobj\n" +
  "4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 30 80 Td (Mango GridFS sample) Tj ET\nendstream endobj\n" +
  "xref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n0000000100 00000 n \n0000000180 00000 n \n" +
  "trailer<</Size 5/Root 1 0 R>>\nstartxref\n265\n%%EOF\n";

interface SampleFile {
  filename: string;
  /** When null the file is uploaded with no contentType — the viewer must
   * then fall back to filename-extension guessing (and ultimately the user's
   * "View as" override for truly opaque names). */
  contentType: string | null;
  body: Buffer;
  metadata?: Record<string, unknown>;
}

const buildSampleFiles = (): SampleFile[] => [
  {
    filename: "readme.md",
    contentType: "text/markdown",
    body: Buffer.from(
      "# Mango GridFS Sample\n\n" +
        "This bucket is seeded so the file viewer has something to click through.\n\n" +
        "- Images preview as `<img>`\n" +
        "- Text-based files preview in Monaco\n" +
        "- PDFs render inline\n" +
        "- Everything else falls back to download\n",
      "utf8",
    ),
    metadata: { tags: ["docs"], generated: true },
  },
  {
    filename: "package.json",
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify(
        { name: "sample", version: "1.0.0", private: true, dependencies: {} },
        null,
        2,
      ),
      "utf8",
    ),
  },
  {
    filename: "notes.txt",
    contentType: "text/plain",
    body: Buffer.from(
      "Plain text file. Useful for testing the text viewer fallback.\n",
      "utf8",
    ),
  },
  {
    filename: "style.css",
    contentType: "text/css",
    body: Buffer.from(
      ":root { --mango: #ffaa00; }\nbody { background: var(--mango); }\n",
      "utf8",
    ),
  },
  {
    filename: "script.ts",
    contentType: "text/typescript",
    body: Buffer.from(
      "export const greet = (name: string): string => `hello, ${name}`;\n",
      "utf8",
    ),
  },
  {
    filename: "chart.svg",
    contentType: "image/svg+xml",
    body: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">' +
        '<rect width="120" height="80" fill="#fef3c7"/>' +
        '<circle cx="60" cy="40" r="28" fill="#f59e0b"/>' +
        '<text x="60" y="46" font-family="sans-serif" font-size="14" text-anchor="middle" fill="white">Mango</text>' +
        "</svg>",
      "utf8",
    ),
  },
  {
    filename: "logo.png",
    contentType: "image/png",
    body: Buffer.from(SAMPLE_PNG_BASE64, "base64"),
  },
  {
    filename: "spec.pdf",
    contentType: "application/pdf",
    body: Buffer.from(SAMPLE_PDF, "binary"),
  },
  {
    filename: "data.bin",
    contentType: "application/octet-stream",
    body: randomBytes(2048),
    metadata: { note: "Opaque binary — viewer should offer download only." },
  },
  // ── Fallback exercise files ───────────────────────────────────────────────
  // No contentType stored — viewer must guess from the .png extension.
  {
    filename: "mystery.png",
    contentType: null,
    body: Buffer.from(SAMPLE_PNG_BASE64, "base64"),
    metadata: { note: "No contentType — relies on extension fallback." },
  },
  // No extension AND no contentType — auto-detect can't help; the user has
  // to pick "Text" (or JSON) from the "View as" override.
  {
    filename: "report",
    contentType: null,
    body: Buffer.from(
      JSON.stringify({ status: "ok", samples: 3, ratio: 0.42 }, null, 2),
      "utf8",
    ),
    metadata: { note: "No extension or contentType — needs manual override." },
  },
  // Unknown extension AND no contentType — also a manual-override case.
  {
    filename: "schema.proto",
    contentType: null,
    body: Buffer.from(
      'syntax = "proto3";\npackage mango;\nmessage Sample { string name = 1; }\n',
      "utf8",
    ),
    metadata: {
      note: "Unknown extension, no contentType — pick a text language manually.",
    },
  },
];

const seedBucket = async (
  db: ReturnType<MongoClient["db"]>,
  bucketName: string,
  files: SampleFile[],
): Promise<void> => {
  const bucket = new GridFSBucket(db, { bucketName });
  for (const file of files) {
    // mongodb v6+ dropped the top-level `contentType` option on
    // GridFSBucketWriteStream — the convention is to nest it under
    // `metadata.contentType`, which is what the viewer route reads. When
    // contentType is null we deliberately omit it so the file exercises the
    // viewer's extension / manual-override fallback paths.
    const meta: Record<string, unknown> = { ...(file.metadata ?? {}) };
    if (file.contentType) meta.contentType = file.contentType;
    const upload = bucket.openUploadStream(file.filename, {
      ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
    });
    await new Promise<void>((resolve, reject) => {
      Readable.from(file.body)
        .pipe(upload)
        .on("error", reject)
        .on("finish", () => resolve());
    });
  }
};

const main = async (): Promise<void> => {
  const client = new MongoClient(MONGO_URL, {
    serverSelectionTimeoutMS: 30_000,
  });
  await client.connect();
  try {
    const acme = client.db("acme");
    const bloggy = client.db("bloggy");
    const cdn = client.db("cdn");

    console.log("[seed] dropping existing sample databases…");
    await Promise.all([acme.dropDatabase(), bloggy.dropDatabase(), cdn.dropDatabase()]);

    console.log("[seed] building documents…");
    const users = buildUsers(50);
    const products = buildProducts(30);
    const orders = buildOrders(120, users, products);
    const posts = buildPosts(40, users);
    const comments = buildComments(220, posts);
    const pagingRows = buildPagingRows(10_000);
    const uuidDocs = buildUuidDocs();

    console.log("[seed] inserting into acme…");
    await Promise.all([
      acme.collection("users").insertMany(users),
      acme.collection("products").insertMany(products),
      acme.collection("orders").insertMany(orders),
      acme.collection("paging").insertMany(pagingRows),
      // Typed explicitly because these docs key some rows by a Binary `_id`
      // (a subtype-4 UUID), which the default ObjectId-only signature rejects.
      acme.collection<SeedUuidDoc>("uuids").insertMany(uuidDocs),
    ]);
    await Promise.all([
      acme.collection("users").createIndex({ email: 1 }, { unique: true }),
      acme.collection("products").createIndex({ sku: 1 }, { unique: true }),
      acme.collection("products").createIndex({ category: 1 }),
      acme.collection("orders").createIndex({ userId: 1, placedAt: -1 }),
      acme.collection("orders").createIndex({ status: 1 }),
      acme.collection("paging").createIndex({ seq: 1 }, { unique: true }),
      acme.collection("uuids").createIndex({ format: 1 }),
    ]);

    console.log("[seed] inserting into bloggy…");
    await Promise.all([
      bloggy.collection("posts").insertMany(posts),
      bloggy.collection("comments").insertMany(comments),
    ]);
    await Promise.all([
      bloggy.collection("posts").createIndex({ slug: 1 }, { unique: true }),
      bloggy.collection("posts").createIndex({ tags: 1 }),
      bloggy.collection("posts").createIndex({ publishedAt: -1 }),
      bloggy.collection("comments").createIndex({ postId: 1, createdAt: -1 }),
    ]);

    console.log("[seed] seeding GridFS buckets…");
    const samples = buildSampleFiles();
    // Default-named `fs` bucket in `cdn` — typical setup.
    await seedBucket(cdn, "fs", samples);
    // Named `media` bucket co-located with the acme app data so users
    // discover GridFS without leaving the database they're already exploring.
    await seedBucket(acme, "media", samples);

    console.log(
      `[seed] done — acme(users=${users.length}, products=${products.length}, orders=${orders.length}, paging=${pagingRows.length}, uuids=${uuidDocs.length}, media=${samples.length} files) bloggy(posts=${posts.length}, comments=${comments.length}) cdn(fs=${samples.length} files)`,
    );
  } finally {
    await client.close();
  }
};

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
