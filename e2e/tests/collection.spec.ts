import { DEMO_DB } from "../scripts/env.js";
import { IDS, expect, test, users } from "./fixtures.js";

/** Baseline coverage of the collection tab: listing, filtering, editing, batch ops. */
test.describe("collection view", () => {
  test.beforeEach(async ({ app }) => {
    await app.openDatabase(DEMO_DB);
    await app.openCollection("users");
  });

  test("lists documents and applies a raw filter", async ({ app }) => {
    await expect(app.rows).toHaveCount(5);
    await expect(app.resultPanel).toContainText("of 5");

    await app.applyFilter(`{ role: "dev" }`);
    await expect(app.rows).toHaveCount(3);
    await expect(app.row("Ada")).toHaveCount(0);
    await expect(app.resultPanel).toContainText("of 3");
  });

  test("updates a document from the drawer", async ({ app, mongo }) => {
    await app.row("Tim").click();
    await expect(app.drawer).toContainText(`${DEMO_DB}.users`);
    await app.editOpenDocument(
      `{ "name": "Tim", "role": "pm", "age": 51, "secret": "s5", "tags": ["web"], "address": { "city": "Geneva" } }`,
    );
    await expect(app.drawer).toContainText("Saved");
    expect((await users(mongo).findOne({ _id: IDS.tim }))?.age).toBe(51);
    await expect(app.row("Tim")).toContainText("51");
  });

  test("deletes a document from the drawer", async ({ app, mongo }) => {
    await app.row("Ada").click();
    await app.deleteOpenDocument();
    await expect(app.drawer).toHaveCount(0);
    await expect(app.rows).toHaveCount(4);
    expect(await users(mongo).findOne({ _id: IDS.ada })).toBeNull();
  });

  test("batch-updates and batch-deletes the selection", async ({ app, mongo }) => {
    await app.selectRows("Grace", "Linus");
    await app.batchUpdate(`{ "$set": { "tags": ["legend"] } }`);
    const legends = await users(mongo).find({ tags: "legend" }).sort({ name: 1 }).toArray();
    expect(legends.map((u) => u.name)).toEqual(["Grace", "Linus"]);

    await app.selectRows("Margaret");
    await app.batchDelete();
    await expect(app.rows).toHaveCount(4);
    expect(await users(mongo).findOne({ _id: IDS.margaret })).toBeNull();
  });
});
