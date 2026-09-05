import test from "node:test";
import assert from "node:assert/strict";
import { directChildren, localFlows, newItem, subtreeIds, validatePlanning } from "../web/planning-model.js";

const item = (id, kind, parentId = null) => ({ id, schemaVersion: 3, kind, parentId, title: id, summary: "", body: "", objective: "", setup: "", resolution: "", tags: [], updatedAt: 1, ...(kind === "event" ? { eventType: "story" } : {}), ...(kind === "branch" ? { branchType: "decision" } : {}) });

test("projection shows only direct children and real local flow", () => {
  const items = [item("quest-a", "quest"), item("quest-b", "quest"), item("event-a", "event", "quest-a")];
  const flows = [{ id: "root-flow", schemaVersion: 3, sourceId: "quest-a", targetId: "quest-b", kind: "continues", label: "", updatedAt: 1 }];
  const dataset = { items, flows, references: [], consequences: [], notes: [], views: [] };
  assert.deepEqual(directChildren(items, null).map(entry => entry.id), ["quest-a", "quest-b"]);
  assert.deepEqual(localFlows(dataset, null).map(entry => entry.id), ["root-flow"]);
  assert.deepEqual(directChildren(items, "quest-a").map(entry => entry.id), ["event-a"]);
});

test("dataset validation rejects cross-scope flow and ownership cycles", () => {
  const items = [item("quest-a", "quest"), item("quest-b", "quest"), item("event-a", "event", "quest-a"), item("event-b", "event", "quest-b")];
  const dataset = { items, flows: [{ id: "bad", schemaVersion: 3, sourceId: "event-a", targetId: "event-b", kind: "continues", label: "", updatedAt: 1 }], references: [], consequences: [], notes: [], views: [] };
  assert.match(validatePlanning(dataset).join(" "), /crosses canvas scopes/);
  assert.deepEqual([...subtreeIds(items, "quest-a")].sort(), ["event-a", "quest-a"]);
});

test("new records use schema v3 and stable safe IDs", () => {
  const created = newItem("branch", null, 42);
  assert.equal(created.schemaVersion, 3);
  assert.equal(created.branchType, "decision");
  assert.match(created.id, /^branch-[a-f0-9-]+$/);
});

test("annotation validation matches the Go ownership and anchor boundary", () => {
  const dataset = { items: [item("quest-a", "quest"), item("quest-b", "quest"), item("event-a", "event", "quest-a")],
    flows: [{ id: "flow-a", sourceId: "quest-a", targetId: "quest-b", kind: "continues" }],
    references: [{ id: "ref-a", itemId: "quest-b", target: { scope: "planning", itemId: "event-a" } }],
    consequences: [{ id: "consequence-a", anchor: { scope: "flow", flowId: "flow-a" } }],
    notes: [{ id: "note-a", anchorIds: ["quest-a", "event-a"] }], views: [] };
  assert.deepEqual(validatePlanning(dataset), []);
  assert.match(validatePlanning({ ...dataset, flows: [] }).join(" "), /missing flow anchor/);
  const withoutEvent = { ...dataset, items: dataset.items.filter(entry => entry.id !== "event-a") };
  assert.match(validatePlanning(withoutEvent).join(" "), /missing planning target/);
  assert.match(validatePlanning(withoutEvent).join(" "), /missing anchor event-a/);
  assert.match(validatePlanning({ ...dataset, references: [{ ...dataset.references[0], itemId: "missing" }] }).join(" "), /missing item/);
  assert.match(validatePlanning({ ...dataset, consequences: [{ id: "bad", anchor: { scope: "item", itemId: "missing" } }] }).join(" "), /missing item anchor/);
});
