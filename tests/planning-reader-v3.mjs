import assert from "node:assert/strict";
import { test } from "node:test";
import { itemAnnotations } from "../web/planning-reader.js";
import { relatedPlanning } from "../web/map-planning.js";

test("reader and map use the same annotations, including flow consequences, without duplicate related items", () => {
  const location = { scope: "core", collection: "locations", id: "harbor" };
  const dataset = { items: [{ id: "one" }, { id: "two" }, { id: "unrelated" }], flows: [{ id: "flow", sourceId: "one", targetId: "two" }],
    references: [{ id: "reference", itemId: "one", target: location }], consequences: [
      { id: "direct", anchor: { scope: "item", itemId: "one" }, target: location },
      { id: "flow-result", anchor: { scope: "flow", flowId: "flow" }, target: location },
      { id: "other", anchor: { scope: "item", itemId: "unrelated" }, target: { ...location, collection: "characters" } },
    ], notes: [{ id: "shared", anchorIds: ["one", "two"] }, { id: "loose", anchorIds: [] }], views: [] };
  assert.deepEqual(relatedPlanning(dataset, "harbor").map(item => item.id), ["one", "two"]);
  assert.deepEqual(relatedPlanning(dataset, "missing"), []);
  assert.deepEqual(itemAnnotations(dataset, "two").consequences.map(value => value.id), ["flow-result"]);
  assert.deepEqual(itemAnnotations(dataset, "one").notes.map(value => value.id), ["shared"]);
  assert.deepEqual(itemAnnotations(dataset, "unrelated").references, []);
});
