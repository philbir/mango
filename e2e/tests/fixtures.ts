import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { MongoClient, ObjectId } from "mongodb";
import { DEMO_DB, MONGO_URL, OTHER_DB } from "../scripts/env.js";

export { expect };

/** Fixed ids so tests can address rows and assert on the database directly. */
export const IDS = {
  ada: new ObjectId("6acb000000000000000000a1"),
  grace: new ObjectId("6acb000000000000000000a2"),
  linus: new ObjectId("6acb000000000000000000a3"),
  margaret: new ObjectId("6acb000000000000000000a4"),
  tim: new ObjectId("6acb000000000000000000a5"),
  noteAlpha: new ObjectId("6acb000000000000000000b1"),
  noteBeta: new ObjectId("6acb000000000000000000b2"),
} as const;

export const USERS = [
  { _id: IDS.ada, name: "Ada", role: "admin", age: 36, secret: "s1", tags: ["ops"], address: { city: "London" } },
  { _id: IDS.grace, name: "Grace", role: "dev", age: 45, secret: "s2", tags: ["js", "db"], address: { city: "Arlington" } },
  { _id: IDS.linus, name: "Linus", role: "dev", age: 54, secret: "s3", tags: ["kernel"], address: { city: "Portland" } },
  { _id: IDS.margaret, name: "Margaret", role: "dev", age: 61, secret: "s4", tags: ["apollo"], address: { city: "Boston" } },
  { _id: IDS.tim, name: "Tim", role: "pm", age: 50, secret: "s5", tags: ["web"], address: { city: "Geneva" } },
];

export const NOTES = [
  { _id: IDS.noteAlpha, title: "alpha", done: false },
  { _id: IDS.noteBeta, title: "beta", done: true },
];

/** Drop and re-create the demo databases so every test starts from the same rows. */
export const seed = async (client: MongoClient) => {
  await client.db(DEMO_DB).dropDatabase();
  await client.db(OTHER_DB).dropDatabase();
  await client.db(DEMO_DB).collection("users").insertMany(USERS);
  await client.db(DEMO_DB).createCollection("counters");
  await client.db(OTHER_DB).collection("notes").insertMany(NOTES);
};

/** Page-level helpers for the parts of Mango the suite drives. */
export class App {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto("/");
    // The health gate mounts the app once /api/health answers.
    await expect(this.page.getByText("Databases")).toBeVisible();
  }

  // Sidebar rows render the name next to a size / count, so the accessible
  // name is "mango_e2e 16K" — match on the name span instead.
  private sidebarRow(name: string): Locator {
    return this.page
      .getByRole("complementary")
      .locator("button", { has: this.page.getByText(name, { exact: true }) })
      .first();
  }

  async openDatabase(name: string) {
    await this.sidebarRow(name).click();
    await expect(this.page.getByPlaceholder("Filter collections…")).toBeVisible();
  }

  async openCollection(name: string) {
    await this.sidebarRow(name).click();
    await expect(this.collectionView).toBeVisible();
  }

  async openConsole() {
    await this.page.getByTitle("New console").click();
    await expect(this.consoleView).toBeVisible();
  }

  get consoleView(): Locator {
    return this.page.getByTestId("console-view");
  }

  get collectionView(): Locator {
    return this.page.getByTestId("collection-view");
  }

  get resultPanel(): Locator {
    return this.page.getByTestId("result-panel");
  }

  get drawer(): Locator {
    return this.page.getByTestId("document-drawer");
  }

  get confirmDialog(): Locator {
    return this.page.getByTestId("confirm-dialog");
  }

  get batchDialog(): Locator {
    return this.page.getByTestId("batch-dialog");
  }

  /** Rows of the result table (header excluded). */
  get rows(): Locator {
    return this.resultPanel.locator("tbody tr");
  }

  row(text: string): Locator {
    return this.rows.filter({ hasText: text });
  }

  /**
   * Put a script in the console editor and run it. The editor is seeded
   * through the same event the assistant uses, which sidesteps Monaco's
   * bracket auto-closing when typing.
   */
  async runConsole(script: string) {
    await this.page.evaluate((command) => {
      window.dispatchEvent(
        new CustomEvent("mango:console:set", { detail: { key: "*", command } }),
      );
    }, script);
    const done = this.page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/console(\?|$)/.test(r.url()),
    );
    await this.consoleView.getByRole("button", { name: "Run" }).click();
    return done;
  }

  /**
   * Replace the text of the first Monaco editor inside `scope`. Typing or
   * `insertText` would trigger Monaco's bracket auto-closing and leave stray
   * closers behind, so the text goes in through a real clipboard paste (the
   * config grants clipboard permissions for this).
   */
  async setEditorText(scope: Locator, text: string) {
    await scope.locator(".monaco-editor").first().click();
    await this.page.keyboard.press("ControlOrMeta+a");
    await this.page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await this.page.keyboard.press("ControlOrMeta+v");
  }

  /** Apply a raw filter in the collection view and wait for the find. */
  async applyFilter(filter: string) {
    await this.setEditorText(this.collectionView, filter);
    const done = this.page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/find(\?|$)/.test(r.url()),
    );
    await this.collectionView.getByRole("button", { name: "Run" }).click();
    return done;
  }

  /** Open the drawer's editor, replace the document body, confirm with the given variant. */
  async editOpenDocument(body: string, variant: "Update" | "Replace" = "Update") {
    await this.drawer.getByRole("button", { name: "Update" }).click();
    await this.setEditorText(this.drawer, body);
    await this.drawer.getByRole("button", { name: "Save" }).click();
    await expect(this.confirmDialog).toBeVisible();
    if (variant === "Replace") {
      await this.confirmDialog.getByRole("button", { name: "Replace", exact: true }).first().click();
    }
    const method = variant === "Replace" ? "PUT" : "PATCH";
    const done = this.page.waitForResponse(
      (r) => r.request().method() === method && r.url().includes("/document/"),
    );
    // The footer holds the Update / Replace variant tabs and the action
    // button, which share a name — the action comes last.
    await this.confirmDialog.locator("footer").getByRole("button", { name: variant }).last().click();
    return done;
  }

  async deleteOpenDocument() {
    await this.drawer.getByRole("button", { name: "Delete" }).click();
    await expect(this.confirmDialog).toBeVisible();
    const done = this.page.waitForResponse(
      (r) => r.request().method() === "DELETE" && r.url().includes("/document/"),
    );
    await this.confirmDialog.locator("footer").getByRole("button", { name: "Delete" }).last().click();
    return done;
  }

  async selectRows(...texts: string[]) {
    for (const text of texts) {
      await this.row(text).getByRole("checkbox", { name: "Select row" }).check();
    }
  }

  /** Open the batch dialog for the current selection and run an updateMany. */
  async batchUpdate(update: string) {
    await this.resultPanel.getByTitle("Update selected documents").click();
    await expect(this.batchDialog).toBeVisible();
    await this.setEditorText(this.batchDialog, update);
    const done = this.page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/updateMany"),
    );
    await this.batchDialog.locator("footer").getByRole("button", { name: "Update" }).click();
    await done;
    await expect(this.batchDialog.getByText(/Matched \d+, modified \d+/)).toBeVisible();
    await this.batchDialog.locator("footer").getByRole("button", { name: "Close" }).click();
  }

  async batchDelete() {
    await this.resultPanel.getByTitle("Delete selected documents").click();
    await expect(this.batchDialog).toBeVisible();
    const done = this.page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/deleteMany"),
    );
    await this.batchDialog.locator("footer").getByRole("button", { name: "Delete" }).click();
    await done;
    await expect(this.batchDialog.getByText(/Deleted \d+ document/)).toBeVisible();
    await this.batchDialog.locator("footer").getByRole("button", { name: "Close" }).click();
  }
}

interface Fixtures {
  app: App;
  /** Seeded before each test; use it to assert what reached the database. */
  mongo: MongoClient;
}

export const test = base.extend<Fixtures>({
  mongo: async ({}, use) => {
    const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    await seed(client);
    await use(client);
    await client.close();
  },
  app: async ({ page, mongo: _mongo }, use) => {
    const app = new App(page);
    await app.open();
    await use(app);
  },
});

export const users = (client: MongoClient) => client.db(DEMO_DB).collection("users");
export const counters = (client: MongoClient) => client.db(DEMO_DB).collection("counters");
export const notes = (client: MongoClient) => client.db(OTHER_DB).collection("notes");
