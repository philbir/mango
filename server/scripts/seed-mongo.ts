// One-shot sample-data seeder for the Aspire-orchestrated dev mongo.
// Connects via MONGO_URL, drops + repopulates the two sample databases below,
// then exits. Wired in via apphost.ts as a `mango-seed` resource that
// `mango-server` waits-for-completion on.
//
// Goal: realistic data with type variety (ObjectId, Decimal128, Date, nested
// docs, arrays) so the Mango UI has something interesting to click through.

import { randomBytes } from "node:crypto";
import { Decimal128, MongoClient, ObjectId } from "mongodb";

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

const main = async (): Promise<void> => {
  const client = new MongoClient(MONGO_URL, {
    serverSelectionTimeoutMS: 30_000,
  });
  await client.connect();
  try {
    const acme = client.db("acme");
    const bloggy = client.db("bloggy");

    console.log("[seed] dropping existing sample databases…");
    await Promise.all([acme.dropDatabase(), bloggy.dropDatabase()]);

    console.log("[seed] building documents…");
    const users = buildUsers(50);
    const products = buildProducts(30);
    const orders = buildOrders(120, users, products);
    const posts = buildPosts(40, users);
    const comments = buildComments(220, posts);

    console.log("[seed] inserting into acme…");
    await Promise.all([
      acme.collection("users").insertMany(users),
      acme.collection("products").insertMany(products),
      acme.collection("orders").insertMany(orders),
    ]);
    await Promise.all([
      acme.collection("users").createIndex({ email: 1 }, { unique: true }),
      acme.collection("products").createIndex({ sku: 1 }, { unique: true }),
      acme.collection("products").createIndex({ category: 1 }),
      acme.collection("orders").createIndex({ userId: 1, placedAt: -1 }),
      acme.collection("orders").createIndex({ status: 1 }),
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

    console.log(
      `[seed] done — acme(users=${users.length}, products=${products.length}, orders=${orders.length}) bloggy(posts=${posts.length}, comments=${comments.length})`,
    );
  } finally {
    await client.close();
  }
};

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
