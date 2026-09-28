import {
  Callout,
  CodeBlock,
  ConfigTable,
  DocList,
  FeatureGrid,
  KeyTable,
  ModeGrid,
  Screenshot,
  SectionHeading,
  type DocSection,
} from "../components/ui";
import type { Feature } from "../data/features";
import { commands } from "../data/commands";
import { href } from "../router";

const workbenchFeatures: Feature[] = [
  {
    title: "Browse without ceremony",
    text: "Pick a connection, a database, a collection — and you are paging real documents in a table or as shell-formatted JSON, with the schema already sampled for completion.",
    glyph: "B",
  },
  {
    title: "Three ways to ask",
    text: "Write the EJSON filter, click it together in the query builder, or describe it to the assistant. All three land in the same filter editor.",
    glyph: "Q",
  },
  {
    title: "A console that knows your schema",
    text: "Multi-statement JavaScript, mongosh-style, with IntelliSense for collections, methods, fields, and operators.",
    glyph: "C",
  },
  {
    title: "Edits you preview first",
    text: "A non-modal document drawer that turns your edit into a diffed $set/$unset — and shows you the command before it runs.",
    glyph: "E",
  },
  {
    title: "Queries that live in Git",
    text: "Save any view to a workspace folder as Markdown. Reopen it later, on the same connection, exactly as you left it.",
    glyph: "W",
  },
  {
    title: "The admin work, too",
    text: "Index usage and management, explain plans, database stats, import and export, dumps, and a GridFS browser.",
    glyph: "A",
  },
];

const docs: DocSection[] = [
  {
    id: "browser",
    eyebrow: "Browse",
    title: "Collection browser",
    body: "Every collection opens in its own tab with three modes — Query, Console, and Info — and a result panel that switches between a table and JSON.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-collection-json.png"
          alt="The customers collection in Mango's JSON result view"
          caption="The JSON view renders documents in shell syntax, so ObjectId, ISODate, and Decimal128 read as the types they are rather than as nested $-objects."
        />
        <ModeGrid
          items={[
            ["Filter editor", "A Monaco editor that accepts canonical EJSON or shell syntax, with completion for field names and query operators. ⌘/Ctrl + Enter runs, Shift + Alt + F formats."],
            ["Projection", "The Fields panel lists every field the schema sampler found. Untick what you don't need and only those fields come back."],
            ["Table and JSON", "A dense table for scanning, JSON for reading. Page size is 50, 100, 200, or 500, with skip/limit paging and a total count."],
            ["Tabs", "Collections, consoles, shells, notebooks, databases, and GridFS buckets each open as a tab, and switching tab follows that tab's connection. Middle-click closes."],
          ]}
        />
      </>
    ),
  },
  {
    id: "query-builder",
    eyebrow: "Compose",
    title: "Query builder",
    body: "For the times you know the fields but not the operator syntax: build conditions row by row and let Mango write the filter.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-query-builder.png"
          alt="Mango's visual query builder with three AND conditions on the customers collection"
          caption="Three conditions, combined with AND. Field names are suggested from the sampled schema, and the builder writes into the same raw filter you can keep editing by hand."
        />
        <ConfigTable
          label="Query builder operators"
          rows={[
            ["equals / not equals", "$eq and $ne. Numbers, true, false, and null are typed; everything else is a string."],
            [">  ≥  <  ≤", "$gt, $gte, $lt, $lte. Numbers compare against int, double, and Decimal128 alike."],
            ["contains / starts with / ends with", "Case-insensitive regular expressions, escaped for you."],
            ["regex", "Your own pattern, case-insensitive."],
            ["in (CSV)", "A comma-separated list becomes an $in array."],
            ["exists", "$exists: true — no value needed."],
          ]}
        />
      </>
    ),
  },
  {
    id: "documents",
    eyebrow: "Edit",
    title: "Editing documents",
    body: "Click any row and the document opens in a drawer beside the results — not a modal, so the table stays usable while you read.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-document-drawer.png"
          alt="A customer document open in Mango's document drawer beside the result table"
          caption="The drawer follows the selection: arrow keys move through the table and the open document moves with them. Esc closes it."
        />
        <ModeGrid
          items={[
            ["Update", "Your edit is diffed against the original and sent as $set / $unset on the fields that changed — the safe choice when someone else may be writing to the same document."],
            ["Replace", "Sends the whole document back with replaceOne, for when the shape itself is what you are changing."],
            ["Preview first", "Both modes show the equivalent shell command before anything executes, so you confirm the command rather than a diff you have to imagine."],
            ["Types survive", "Editing happens in shell syntax, so ObjectId, ISODate, Decimal128, and binary UUIDs round-trip intact — plain JSON would flatten them."],
          ]}
        />
      </>
    ),
  },
  {
    id: "batch",
    eyebrow: "Bulk",
    title: "Batch operations",
    body: "Tick rows — across pages if you need to — and run one update or one delete over the whole selection.",
    content: () => (
      <ModeGrid
        items={[
          ["Batch update", "Write an update operator document ($set, $inc, $unset, …) and Mango runs it with updateMany against the selection — showing the exact command first."],
          ["Batch delete", "deleteMany against the selection, behind a preview that tells you how many documents will go."],
        ]}
      />
    ),
  },
  {
    id: "console",
    eyebrow: "Script",
    title: "JavaScript console",
    body: "A mongosh-style console that runs real scripts — variables, loops, functions, and multiple statements — against the active database, with results paged into the same table and JSON views.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-console.png"
          alt="An aggregation pipeline run in the Mango console with results grouped by sales channel"
          caption="Revenue by channel, straight from the console. Scripts run server-side in a sandbox; the last expression is the result, and print / printjson output goes to a logs panel."
        />
        <div className="code-grid">
          <CodeBlock title="A multi-statement console script" code={commands.consoleScript} />
          <ConfigTable
            label="Console API"
            rows={[
              ["Reads", "find, findOne, aggregate, countDocuments, estimatedDocumentCount, distinct"],
              ["Writes", "insertOne, insertMany, updateOne, updateMany, replaceOne, deleteOne, deleteMany"],
              ["Admin", "createIndex, dropIndex, getIndexes, stats, rename, drop"],
              ["db helpers", "getName, getSiblingDB, getCollection, getCollectionNames, createCollection, runCommand"],
              ["BSON helpers", "ObjectId, ISODate, UUID, NumberDecimal and friends"],
            ]}
          />
        </div>
        <Callout title="IntelliSense that knows your data">
          After <code>db.</code> the console completes collection names; after{" "}
          <code>db.orders.</code> it completes methods; inside the call it completes the field names
          Mango sampled from that collection, and the query operators that fit. Deployments that want no
          scripting at all can turn the console off with <code>MANGO_DISABLE_JS_CONSOLE=true</code>.
        </Callout>
      </>
    ),
  },
  {
    id: "shell",
    eyebrow: "Commands",
    title: "Command shell",
    body: "For database commands rather than scripts: send one command document to db.runCommand and read the raw reply.",
    content: () => (
      <Screenshot
        src="./screenshots/mango-shell.png"
        alt="The Mango shell running dbStats with presets for ping, buildInfo, serverStatus, and more"
        caption="Presets for ping, buildInfo, dbStats, serverStatus, listCollections, and connectionStatus — or write any command in JSON or shell syntax. Every command runs with the server-side timeout."
      />
    ),
  },
  {
    id: "workspaces",
    eyebrow: "Save your work",
    title: "Workspaces",
    body: "Register a folder on disk as a workspace and Mango saves your queries, console scripts, and notebooks there as plain Markdown files you can commit alongside your code.",
    content: () => (
      <>
        <ConfigTable
          label="Workspace file kinds"
          rows={[
            ["*.mnq.md", "A query: the collection, the filter, and the projected fields. Opens in the collection browser."],
            ["*.mnc.md", "A console script. Opens in the console, bound to its collection."],
            ["*.mnn.md", "A notebook: a free-form script with a Markdown description above it."],
          ]}
        />
        <div className="code-grid section-gap">
          <CodeBlock title="support/refunds-mobile.mnq.md" code={commands.workspaceQuery} />
          <ModeGrid
            items={[
              ["The extension decides the view", "Frontmatter carries the connection, database, collection, and fields; the script lives in a ```mongo fence, so the file renders as ordinary Markdown on GitHub."],
              ["Save from anywhere", "Save to workspace is in the collection browser, the console, and the notebook. Once a view is bound to a file, ⌘/Ctrl + S updates it."],
              ["A real file tree", "Create files and folders, rename with F2, delete with Delete, drag to move. Changes made outside Mango are picked up."],
              ["Git-aware", "The sidebar shows the workspace's branch, short commit, and whether it has uncommitted changes. Commit with the tools you already use."],
            ]}
          />
        </div>
        <Callout title="Where workspaces are available">
          Workspaces are enabled when the server's filesystem is your filesystem — the desktop app and
          a local server. They are off in Docker and standalone Aspire deployments, where the server
          runs somewhere your folders are not.
        </Callout>
      </>
    ),
  },
  {
    id: "notebooks",
    eyebrow: "Explore",
    title: "Notebooks",
    body: "A notebook is a longer script with its own description — the place for a weekly report, a data fix you want reviewed, or an investigation you will come back to.",
    content: () => (
      <Screenshot
        src="./screenshots/mango-notebook.png"
        alt="A Mango notebook opened from the shop-queries workspace, with the branch badge and a result table"
        caption="Select a fragment to run just that, or run everything. The workspace tree on the left shows the Git branch and every Mango file in the folder."
      />
    ),
  },
  {
    id: "indexes",
    eyebrow: "Performance",
    title: "Indexes and explain",
    body: "The Info tab of every collection holds its stats, its indexes, and a playground for explain plans.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-indexes.png"
          alt="The Indexes panel listing three indexes with their keys and usage counts"
          caption="Usage counts come from $indexStats, so an index nobody hits is easy to spot. Create indexes (ascending, descending, text, 2dsphere, hashed; unique and sparse) or drop them with a confirmation."
        />
        <ModeGrid
          items={[
            ["Query playground", "Run explain for a find (filter + sort) or an aggregate pipeline at queryPlanner, executionStats, or allPlansExecution verbosity. The key numbers are pulled out above the raw plan."],
            ["Optimize with AI", "Hand the plan and your current indexes to the assistant and ask what to change. See Mango AI for how that works."],
            ["Collection stats", "Documents, data and storage size, average document size, index sizes, capped and sharded flags — with Clear and Drop behind confirmations."],
          ]}
        />
      </>
    ),
  },
  {
    id: "stats",
    eyebrow: "Overview",
    title: "Database stats",
    body: "Open a database for dbStats and a per-collection breakdown, plus a Connection tab describing the server you are talking to.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-database-stats.png"
          alt="Database statistics for the shop database with a per-collection table"
          caption="Collections, documents, data, storage, and index sizes at a glance, with filesystem headroom — and a table that makes the heavy collection obvious."
        />
        <ModeGrid
          items={[
            ["Connection tab", "Server version and edition, topology, replica-set name, ping, uptime, and connection counts, next to the client and Mango versions."],
            ["Dev tools", "With MANGO_DEV_MODE=true a database also gets Clear all collections and Delete database — handy for a local dev loop, hidden everywhere else."],
          ]}
        />
      </>
    ),
  },
  {
    id: "import-export",
    eyebrow: "Move data",
    title: "Import, export, dump, restore",
    body: "When the MongoDB Database Tools are on the server's PATH — they are baked into the Docker image — each database gets an Import / Export tab.",
    content: () => (
      <ConfigTable
        label="Import and export actions"
        rows={[
          ["Export collection", "mongoexport to a JSON array, downloaded in the browser."],
          ["Import collection", "mongoimport from a JSON array, in insert, upsert, or merge mode, optionally dropping the collection first."],
          ["Dump database", "mongodump to a gzipped .archive.gz."],
          ["Restore database", "mongorestore from an archive — optionally dropping first, or restoring under a different database name."],
        ]}
      />
    ),
  },
  {
    id: "gridfs",
    eyebrow: "Files",
    title: "GridFS",
    body: "GridFS buckets are recognised in the sidebar and open as a file browser rather than two raw collections.",
    content: () => (
      <Screenshot
        src="./screenshots/mango-gridfs.png"
        alt="A GridFS bucket in Mango with an image file previewed in the viewer drawer"
        caption="Search by name, then preview images, text (in the code editor), and PDFs inline. Download or delete any file; the Document tab shows the raw files-collection entry."
      />
    ),
  },
  {
    id: "connections",
    eyebrow: "Connect",
    title: "Connections",
    body: "Save as many connections as you like. Each gets a name, a colour, and an optional default database; the URI is encrypted at rest.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-connection-form.png"
          alt="The New connection dialog with an SRV connection string parsed into the form"
          caption="Paste a connection string or fill the form — the two stay in sync. The Docker and Aspire buttons discover running MongoDB containers and AppHost resources for you."
        />
        <ModeGrid
          items={[
            ["Topologies", "Direct, replica set (with the set name), or DNS / SRV for Atlas — with TLS, authSource, and a default database."],
            ["Test before saving", "Test connection works on an unsaved URI, and a background ping keeps the health dot in the picker honest."],
            ["Docker discovery", "Finds MongoDB containers on the local Docker socket and reads their credentials from the container environment."],
            ["Aspire discovery", "Lists running AppHosts (Aspire CLI 13+) and their Mongo resources. An Aspire-linked connection re-resolves its connection string every time it connects, so a new port never breaks it."],
          ]}
        />
      </>
    ),
  },
  {
    id: "auth",
    eyebrow: "Identity",
    title: "Authentication",
    body: "Username and password, or your corporate identity — both are in the free build.",
    content: () => (
      <>
        <ConfigTable
          label="Authentication methods"
          rows={[
            ["None", "For local development databases."],
            ["SCRAM-SHA-256 / SCRAM-SHA-1", "Username and password, with authSource."],
            ["PLAIN", "LDAP-proxied username and password."],
            ["MONGODB-OIDC · Azure CLI", "Reuses the account az login is signed in as — no password stored at all."],
            ["MONGODB-OIDC · browser", "An interactive Microsoft Entra sign-in with your client and tenant id. Pick which installed browser and profile handles it, so a work tenant doesn't land in your personal session."],
          ]}
        />
        <p className="doc-note">
          A tab on an OIDC connection waits behind a sign-in prompt until you have authenticated, so
          nothing fires half-authorised requests in the background.
        </p>
      </>
    ),
  },
  {
    id: "preferences",
    eyebrow: "Make it yours",
    title: "Formats and preferences",
    body: "One format setting drives the result list, the document viewer, and the editor, so a value looks the same everywhere you meet it.",
    content: () => (
      <ConfigTable
        label="Preferences"
        rows={[
          ["Theme", "System (follows your OS live), Light, or Dark."],
          ["JSON format", "Shell syntax, canonical EJSON, relaxed EJSON, or plain JSON."],
          ["Dates", "Local time or UTC."],
          ["Legacy UUIDs", "Standard, C# legacy (CSUUID), Java legacy (JUUID), Python legacy (PYUUID), or unspecified — binary subtype 3 decoded the way your driver wrote it."],
          ["Page size", "50, 100, 200, or 500 documents."],
          ["Default mode", "Open collections in Query or in Console."],
          ["Tabs", "Multi-tab (the default) or a single view that follows the sidebar."],
        ]}
      />
    ),
  },
  {
    id: "shortcuts",
    eyebrow: "Reference",
    title: "Keyboard shortcuts",
    body: "The few that matter every day.",
    content: () => (
      <KeyTable
        rows={[
          [["⌘/Ctrl", "Enter"], "Run the filter, console, shell, or notebook"],
          [["⌘/Ctrl", "I"], "Toggle the AI assistant"],
          [["⌘/Ctrl", "S"], "Save to the bound workspace file"],
          [["Shift", "Alt", "F"], "Format the editor contents"],
          [["↑", "↓"], "Move through result rows (the drawer follows)"],
          [["Esc"], "Close the drawer, a dialog, or the GridFS viewer"],
          [["F2"], "Rename in the workspace tree"],
          [["Enter"], "Send a chat message (Shift + Enter for a newline)"],
        ]}
      />
    ),
  },
];

export const FeaturesPage = () => (
  <>
    <section className="product-hero">
      <div className="product-hero-copy">
        <span className="kicker product-eyebrow">
          <span className="product-index large">01</span> Workbench
        </span>
        <h1>Everything you do in MongoDB, in one window.</h1>
        <p className="lead">
          Browse and edit documents, compose filters by hand or by clicking, script the console,
          manage indexes, move data in and out, and keep the queries worth keeping as Markdown in
          your repository.
        </p>
        <div className="hero-actions">
          <a className="button primary" href={href("download")}>
            Download Mango
          </a>
          <a className="button ghost" href={href("ai")}>
            The AI features
          </a>
        </div>
        <div className="proof-row">
          <span>Table + JSON</span>
          <span>Query builder</span>
          <span>Console</span>
          <span>Notebooks</span>
          <span>Workspaces</span>
          <span>Indexes</span>
          <span>GridFS</span>
          <span>OIDC</span>
        </div>
      </div>
      <picture className="product-hero-visual">
        <img
          src="./screenshots/mango-query-builder.png"
          alt="Mango's collection browser with the visual query builder"
        />
      </picture>
    </section>

    <section className="section" id="workbench-features">
      <SectionHeading kicker="What it does" title="A MongoDB client that stays out of your way.">
        Mango is intentionally focused: the things you do every day are one click away, and the
        things you do once a month are still there when you need them. Every feature below is in the
        free build; there is no other build.
      </SectionHeading>
      <FeatureGrid features={workbenchFeatures} />
    </section>

    <section className="docs-wrap">
      <DocList docs={docs} />
    </section>
  </>
);
