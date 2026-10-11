import { DEMO_DB, OTHER_DB } from "../scripts/env.js";
import { IDS, counters, expect, notes, test, users } from "./fixtures.js";

/**
 * Editing from the JavaScript console. A plain find() cursor is editable:
 * the server reports the cursor's namespace, the UI writes edits back through
 * the document endpoints and never re-runs the script. Anything else stays
 * read-only with a hint saying why.
 */
test.describe("console editing", () => {
  test.beforeEach(async ({ app }) => {
    await app.openDatabase(DEMO_DB);
    await app.openConsole();
  });

  test("find() rows can be updated from the drawer without re-running the script", async ({
    app,
    mongo,
  }) => {
    // The script has a side effect so a re-run would be visible.
    await app.runConsole(
      `db.counters.updateOne({ _id: "runs" }, { $inc: { n: 1 } }, { upsert: true });\n` +
        `db.users.find({ role: "dev" })`,
    );
    await expect(app.rows).toHaveCount(3);
    await expect(app.resultPanel.getByTestId("result-readonly-hint")).toHaveCount(0);
    await expect(app.rows.first().getByRole("checkbox", { name: "Select row" })).toBeVisible();

    await app.row("Grace").click();
    await expect(app.drawer).toBeVisible();
    await expect(app.drawer).toContainText(`${DEMO_DB}.users`);
    await expect(app.drawer.getByRole("button", { name: "Update" })).toBeVisible();

    await app.editOpenDocument(
      `{ "name": "Grace", "role": "dev", "age": 46, "secret": "s2", "tags": ["js", "db"], "address": { "city": "Arlington" } }`,
    );
    await expect(app.drawer).toContainText("Saved");

    const grace = await users(mongo).findOne({ _id: IDS.grace });
    expect(grace?.age).toBe(46);
    expect(grace?.secret).toBe("s2");
    // Row refreshed in place, script not re-run.
    await expect(app.row("Grace")).toContainText("46");
    expect((await counters(mongo).findOne({ _id: "runs" as never }))?.n).toBe(1);
  });

  test("find() rows can be deleted from the drawer", async ({ app, mongo }) => {
    await app.runConsole(`db.users.find().sort({ name: 1 })`);
    await expect(app.rows).toHaveCount(5);

    await app.row("Linus").click();
    await app.deleteOpenDocument();

    await expect(app.drawer).toHaveCount(0);
    await expect(app.rows).toHaveCount(4);
    await expect(app.row("Linus")).toHaveCount(0);
    expect(await users(mongo).findOne({ _id: IDS.linus })).toBeNull();
    expect(await users(mongo).countDocuments()).toBe(4);
  });

  test("selected rows can be batch-updated", async ({ app, mongo }) => {
    await app.runConsole(`db.users.find({ role: "dev" })`);
    await expect(app.rows).toHaveCount(3);

    await app.selectRows("Grace", "Margaret");
    await expect(app.resultPanel.getByText("2 selected")).toBeVisible();
    await app.batchUpdate(`{ "$set": { "role": "qa" } }`);

    const qa = await users(mongo).find({ role: "qa" }).sort({ name: 1 }).toArray();
    expect(qa.map((u) => u.name)).toEqual(["Grace", "Margaret"]);
    expect((await users(mongo).findOne({ _id: IDS.linus }))?.role).toBe("dev");
    // Rows re-read by _id; the untouched one is unchanged.
    await expect(app.row("Grace")).toContainText("qa");
    await expect(app.row("Margaret")).toContainText("qa");
    await expect(app.row("Linus")).toContainText("dev");
    await expect(app.resultPanel.getByText(/selected/)).toHaveCount(0);
  });

  test("selected rows can be batch-deleted", async ({ app, mongo }) => {
    await app.runConsole(`db.users.find()`);
    await expect(app.rows).toHaveCount(5);

    await app.selectRows("Ada", "Tim");
    await app.batchDelete();

    await expect(app.rows).toHaveCount(3);
    await expect(app.row("Ada")).toHaveCount(0);
    await expect(app.row("Tim")).toHaveCount(0);
    expect(await users(mongo).countDocuments()).toBe(3);
    expect(await users(mongo).findOne({ _id: IDS.ada })).toBeNull();
    expect(await users(mongo).findOne({ _id: IDS.tim })).toBeNull();
  });

  test("aggregate results are read-only", async ({ app }) => {
    await app.runConsole(`db.users.aggregate([{ $match: { role: "dev" } }, { $sort: { age: 1 } }])`);
    await expect(app.rows).toHaveCount(3);
    await expect(app.resultPanel.getByTestId("result-readonly-hint")).toContainText("aggregation");
    await expect(app.rows.first().getByRole("checkbox")).toHaveCount(0);

    await app.row("Grace").click();
    await expect(app.drawer).toBeVisible();
    await expect(app.drawer.getByRole("button", { name: "Update" })).toHaveCount(0);
    await expect(app.drawer.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });

  test("a projected find loads the full document for editing", async ({ app, mongo }) => {
    await app.runConsole(`db.users.find({ name: "Ada" }, { name: 1, age: 1 })`);
    await expect(app.rows).toHaveCount(1);
    // The table shows only projected columns.
    await expect(app.resultPanel.locator("thead")).not.toContainText("secret");

    const fullDoc = app.page.waitForResponse(
      (r) => r.request().method() === "GET" && r.url().includes("/document/"),
    );
    await app.row("Ada").click();
    await fullDoc;
    // The drawer shows the whole document, including fields the find() left out.
    await expect(app.drawer).toContainText('"secret" : "s1"');
    await expect(app.drawer).toContainText('"role" : "admin"');

    // Replacing writes the full document back, so nothing projected out is lost.
    await app.editOpenDocument(
      `{ "name": "Ada", "role": "admin", "age": 37, "secret": "s1", "tags": ["ops"], "address": { "city": "London" } }`,
      "Replace",
    );
    const ada = await users(mongo).findOne({ _id: IDS.ada });
    expect(ada).toMatchObject({ name: "Ada", role: "admin", age: 37, secret: "s1" });
    // The row keeps its projected shape, just with fresh values.
    await expect(app.row("Ada")).toContainText("37");
    await expect(app.resultPanel.locator("thead")).not.toContainText("secret");
  });

  test("a projection that drops _id is read-only", async ({ app }) => {
    await app.runConsole(`db.users.find({}, { _id: 0, name: 1 })`);
    await expect(app.rows).toHaveCount(5);
    await expect(app.resultPanel.getByTestId("result-readonly-hint")).toContainText("excludes _id");
    await expect(app.rows.first().getByRole("checkbox")).toHaveCount(0);
  });

  test("a mapped cursor is read-only", async ({ app }) => {
    await app.runConsole(`db.users.find().map((u) => ({ _id: u._id, label: u.name.toUpperCase() }))`);
    await expect(app.rows).toHaveCount(5);
    await expect(app.row("GRACE")).toBeVisible();
    await expect(app.resultPanel.getByTestId("result-readonly-hint")).toContainText(".map()");
    await expect(app.rows.first().getByRole("checkbox")).toHaveCount(0);
  });

  test("an array result from .toArray() explains how to get an editable cursor", async ({ app }) => {
    await app.runConsole(`db.users.find({ role: "dev" }).toArray()`);
    await expect(app.rows).toHaveCount(3);
    await expect(app.resultPanel.getByTestId("result-readonly-hint")).toContainText("without .toArray()");
    await expect(app.rows.first().getByRole("checkbox")).toHaveCount(0);
  });

  test("edits follow the database the cursor ran against, not the selected one", async ({
    app,
    mongo,
  }) => {
    await app.runConsole(`use ${OTHER_DB}\ndb.notes.find().sort({ title: 1 })`);
    await expect(app.rows).toHaveCount(2);

    await app.row("alpha").click();
    await expect(app.drawer).toContainText(`${OTHER_DB}.notes`);
    const res = await app.editOpenDocument(`{ "title": "alpha", "done": true }`);
    expect(res.url()).toContain(`database=${OTHER_DB}`);

    expect((await notes(mongo).findOne({ _id: IDS.noteAlpha }))?.done).toBe(true);
    // Nothing leaked into the selected database.
    expect(await mongo.db(DEMO_DB).collection("notes").countDocuments()).toBe(0);
  });

  test("a non-document result still renders", async ({ app }) => {
    await app.runConsole(`db.users.countDocuments({ role: "dev" })`);
    await expect(app.resultPanel).toContainText("3");
    await expect(app.rows).toHaveCount(0);
  });
});
