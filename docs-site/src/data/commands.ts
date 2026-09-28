/** Code samples shown across the docs. Keep them runnable as written. */
export const commands = {
  aspire: `using Aspire.Hosting;

var builder = DistributedApplication.CreateBuilder(args);

var mongo = builder.AddMongoDB("mongo")
    .WithLifetime(ContainerLifetime.Persistent);

mongo.WithMango();   // ← adds Mango, wired to this Mongo

builder.Build().Run();`,

  aspireInstall: `dotnet add package Mango.Aspire.Hosting`,

  aspireOptions: `mongo.WithMango(
    databaseName: "shop",   // open this database by default
    port: 5180,             // host port for the Mango UI
    standalone: false,      // show the full connection manager
    devMode: true,          // Clear all / Delete database in the UI
    tag: "0.4.1");          // pin the image instead of :latest`,

  aspireConfig: `{
  "Mango": {
    "MasterKey": "<32-byte key, base64 or hex>",
    "Ai": {
      "Provider": "openai",
      "ApiKey": "sk-...",
      "Model": "gpt-4o-mini"
    }
  }
}`,

  docker: `docker run --rm -p 127.0.0.1:5180:5180 \\
  -e MONGO_URL="mongodb://host.docker.internal:27017/app" \\
  -e MANGO_MODE=standalone \\
  -v mango-data:/data \\
  ghcr.io/philbir/mango:latest`,

  compose: `services:
  mongo:
    image: mongo:8
    volumes: ["mongo-data:/data/db"]

  mango:
    image: ghcr.io/philbir/mango:latest
    depends_on: [mongo]
    ports: ["127.0.0.1:5180:5180"]
    environment:
      MONGO_URL: mongodb://mongo:27017/app
      MANGO_MODE: standalone
      MANGO_MASTER_KEY: \${MANGO_MASTER_KEY}
    volumes: ["mango-data:/data"]

volumes:
  mongo-data:
  mango-data:`,

  masterKey: `# 32 random bytes, base64 — keep it with your other secrets
openssl rand -base64 32`,

  consoleScript: `const since = ISODate("2026-08-01T00:00:00Z");

const refunded = db.orders.countDocuments({
  status: "refunded",
  placedAt: { $gte: since },
});

print(\`refunds since August: \${refunded}\`);

db.orders.aggregate([
  { $match: { placedAt: { $gte: since } } },
  { $group: { _id: "$status", orders: { $sum: 1 } } },
  { $sort: { orders: -1 } },
])`,

  workspaceQuery: `---
mango:
  collection: orders
  connection: Default
  database: shop
  fields: orderNo, status, channel, total, placedAt
---

Refunded mobile orders — used when triaging
app-store payment complaints.

\`\`\`mongo
{ "status": "refunded", "channel": "mobile" }
\`\`\``,

  aiFilterExample: `Prompt: "refunded orders over 100 placed via the mobile channel in August"

{
  "status": "refunded",
  "channel": "mobile",
  "total": { "$gt": { "$numberDecimal": "100" } },
  "placedAt": {
    "$gte": { "$date": "2026-08-01T00:00:00.000Z" },
    "$lt":  { "$date": "2026-09-01T00:00:00.000Z" }
  }
}`,

  aiCopilot: `AI_PROVIDER=copilot
# uses the copilot CLI's own login, or:
GITHUB_TOKEN=github_pat_...`,

  aiClaude: `AI_PROVIDER=claude-code
AI_MODEL=sonnet
# uses the claude CLI's login, or:
ANTHROPIC_API_KEY=sk-ant-...`,

  aiCodex: `AI_PROVIDER=codex
# AI_MODEL unset = your Codex account default
MANGO_CODEX_CLI=/Applications/ChatGPT.app/Contents/Resources/codex`,

  aiOpenAi: `AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1`,

  aiOllama: `AI_PROVIDER=openai
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.1
# any value — Ollama ignores the key
AI_API_KEY=ollama`,

  buildDesktop: `pnpm install
pnpm compile-server   # builds the sidecar binary (needs Bun)
pnpm tauri:build      # .dmg / .msi / .deb`,
};
