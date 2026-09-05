import test from "node:test";
import assert from "node:assert/strict";
import { PlanningRepository } from "../web/planning-repository.js";
import { validatePlanning } from "../web/planning-model.js";

test("repository loads all declared collections and keeps exact revisions", async () => {
  const calls = [];
  const context = {
    signal: new AbortController().signal,
    data: {
      collection: id => ({
        query: async () => { calls.push(id); return { documents: id === "planning_items" ? [{ key: "quest-a", revision: 7, value: validQuest() }] : [] }; },
        put: async () => assert.fail("not used"), delete: async () => assert.fail("not used"),
      }),
      transact: async () => assert.fail("not used"),
    },
  };
  const snapshot = await new PlanningRepository(context).load();
  assert.equal(calls.length, 6);
  assert.equal(snapshot.items[0].id, "quest-a");
  assert.equal(snapshot.revisions.get("planning_items:quest-a"), 7);
});

test("subtree deletion publishes one explicit cross-collection transaction", async () => {
  let mutations;
  const handles = new Map();
  const context = {
    signal: new AbortController().signal,
    data: {
      collection: id => handles.get(id) ?? { query: async () => ({ documents: [] }), put: async () => {}, delete: async () => {} },
      transact: async value => { mutations = value; },
    },
  };
  const repository = new PlanningRepository(context);
  const quest = validQuest(); const event = { ...validQuest(), id: "event-a", kind: "event", parentId: "quest-a", eventType: "story" };
  const sibling = { ...validQuest(), id: "quest-b", title: "Quest B" };
  const note = { id: "note-a", schemaVersion: 3, title: "Shared note", body: "", anchorIds: ["quest-a", "quest-b"], updatedAt: 1 };
  const snapshot = { items: [quest, event, sibling], flows: [], references: [], consequences: [], notes: [note], views: [], revisions: new Map([["planning_items:quest-a", 2], ["planning_items:event-a", 3], ["planning_items:quest-b", 4], ["dm_notes:note-a", 5]]) };
  await repository.deleteSubtree(snapshot, "quest-a");
  assert.deepEqual(mutations.map(entry => [entry.operation, entry.dataId, entry.key, entry.expectedRevision]), [["delete", "planning_items", "quest-a", 2], ["delete", "planning_items", "event-a", 3], ["put", "dm_notes", "note-a", 5]]);
  assert.deepEqual(mutations[2].value.anchorIds, ["quest-b"]);
});

function validQuest() { return { id: "quest-a", schemaVersion: 3, kind: "quest", parentId: null, title: "Quest A", summary: "", body: "", objective: "", setup: "", resolution: "", tags: [], updatedAt: 1 }; }

function deletionFixture() {
  const dataset = {
    items: [validQuest(), { ...validQuest(), id: "quest-b" }, { ...validQuest(), id: "event-a", kind: "event", eventType: "story", parentId: "quest-a" }],
    flows: [{ id: "flow-a", schemaVersion: 3, sourceId: "quest-a", targetId: "quest-b", kind: "continues", label: "Passage", updatedAt: 1 }],
    references: [{ id: "ref-a", itemId: "quest-b", target: { scope: "planning", itemId: "event-a" } }],
    consequences: [{ id: "flow-consequence", anchor: { scope: "flow", flowId: "flow-a" } }, { id: "item-consequence", anchor: { scope: "item", itemId: "quest-b" } }],
    notes: [{ id: "shared-note", anchorIds: ["event-a", "quest-b"], title: "Shared", body: "Keep me" }],
    views: [{ id: "scope-root", schemaVersion: 3, scopeId: null, positions: { "quest-a": { x: 24, y: 24 }, "quest-b": { x: 300, y: 24 } }, updatedAt: 1 },
      { id: "scope-quest-a", schemaVersion: 3, scopeId: "quest-a", positions: { "event-a": { x: 48, y: 48 } }, updatedAt: 1 }],
    revisions: new Map(),
  };
  const collections = { items: "planning_items", flows: "planning_flow_links", references: "planning_references", consequences: "planning_consequences", notes: "dm_notes", views: "planning_views" };
  for (const [key, collection] of Object.entries(collections)) for (const record of dataset[key]) dataset.revisions.set(`${collection}:${record.id}`, dataset.revisions.size + 1);
  const writes = [];
  const repository = new PlanningRepository({ signal: new AbortController().signal, data: { collection: () => ({}), transact: async mutations => { writes.push(mutations); } } });
  return { dataset, repository, writes, collections };
}

test("deleting a flow atomically removes its consequences without deleting endpoint annotations", async () => {
  const { dataset, repository, writes } = deletionFixture();
  await repository.deleteFlow(dataset, "flow-a");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].map(entry => [entry.operation, entry.dataId, entry.key]), [
    ["delete", "planning_flow_links", "flow-a"], ["delete", "planning_consequences", "flow-consequence"],
  ]);
  for (const mutation of writes[0]) assert.equal(mutation.expectedRevision, dataset.revisions.get(`${mutation.dataId}:${mutation.key}`));
});

test("subtree deletion cleans incoming planning references and saved positions while retaining shared notes", async () => {
  const { dataset, repository, writes, collections } = deletionFixture();
  await repository.deleteSubtree(dataset, "quest-a");
  assert.equal(writes.length, 1);
  const mutations = writes[0];
  assert.ok(mutations.some(entry => entry.operation === "delete" && entry.key === "ref-a"));
  assert.ok(mutations.some(entry => entry.operation === "delete" && entry.key === "scope-quest-a"));
  const shared = mutations.find(entry => entry.key === "shared-note"); assert.deepEqual(shared.value.anchorIds, ["quest-b"]); assert.equal(shared.value.body, "Keep me");
  const rootView = mutations.find(entry => entry.key === "scope-root"); assert.deepEqual(rootView.value.positions, { "quest-b": { x: 300, y: 24 } });
  const remaining = {};
  for (const [key, collection] of Object.entries(collections)) {
    remaining[key] = dataset[key].flatMap(record => {
      const mutation = mutations.find(entry => entry.dataId === collection && entry.key === record.id);
      return mutation?.operation === "delete" ? [] : [mutation?.value ?? record];
    });
  }
  assert.deepEqual(validatePlanning(remaining), []);
  assert.deepEqual(remaining.consequences.map(record => record.id), ["item-consequence"]);
});

test("deletion refuses missing revisions or oversized transactions before publishing any writes", async () => {
  const { dataset, repository, writes } = deletionFixture();
  dataset.revisions.delete("planning_consequences:flow-consequence");
  await assert.rejects(repository.deleteFlow(dataset, "flow-a"), /revision is missing/);
  assert.equal(writes.length, 0);
  dataset.consequences = Array.from({ length: 256 }, (_, index) => ({ id: `consequence-${index}`, anchor: { scope: "flow", flowId: "flow-a" } }));
  for (const consequence of dataset.consequences) dataset.revisions.set(`planning_consequences:${consequence.id}`, 1);
  await assert.rejects(repository.deleteFlow(dataset, "flow-a"), /more than 256/);
  assert.equal(writes.length, 0);
});

test("leaving a view aborts paginated reads without stopping its activation generation", async () => {
  const generation = new AbortController(), view = new AbortController();
  let calls = 0;
  const repository = new PlanningRepository({ signal: generation.signal, data: { collection: () => ({
    query: async ({ signal }) => { calls++; assert.equal(signal.aborted, false); view.abort(); return { documents: [], nextCursor: "next" }; },
  }) } });
  await assert.rejects(repository.load(view.signal), { name: "AbortError" });
  assert.equal(calls, 1); assert.equal(generation.signal.aborted, false);
});
