import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../addon.json", import.meta.url), "utf8"));
test("manifest declares TypeScript UI, Go worker, and exact planning contracts", () => {
  assert.equal(manifest.packageFormat, 1); assert.equal(manifest.version, "3.0.0"); assert.equal(manifest.runtime.ui.entry, "web/index.js");
  assert.equal(manifest.runtime.worker.type, "native"); assert.equal(Object.keys(manifest.runtime.worker.entrypoints).length, 3);
  assert.deepEqual(manifest.collections.map(entry => entry.id), ["planning_items", "planning_flow_links", "planning_references", "planning_consequences", "dm_notes", "planning_views"]);
  assert.equal(manifest.services.provides[0].contract, "codex.import-adapter"); assert.equal(manifest.services.provides[0].version, "2.0.0");
  assert.equal(manifest.services.consumes[0].cardinality, "many"); assert.equal(manifest.services.consumes[0].selection, "all-compatible");
  assert.deepEqual(manifest.permissions.map(({ id, resources }) => ({ id, resources })), [{ id: "core.data.read", resources: ["characters", "factions", "locations", "mysteries", "artifacts", "events"] }]);
});

test("every stored collection has a package-owned schema", async () => {
  for (const collection of manifest.collections) {
    const schema = JSON.parse(await readFile(new URL(`../${collection.schema}`, import.meta.url), "utf8"));
    assert.equal(schema.type, "object"); assert.equal(schema.additionalProperties, false);
  }
});
