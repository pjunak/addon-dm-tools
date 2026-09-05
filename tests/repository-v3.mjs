import test from "node:test";
import assert from "node:assert/strict";
import { PlanningRepository } from "../web/planning-repository.js";

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

test("leaving a view aborts paginated reads without stopping its activation generation", async () => {
  const generation = new AbortController(), view = new AbortController();
  let calls = 0;
  const repository = new PlanningRepository({ signal: generation.signal, data: { collection: () => ({
    query: async ({ signal }) => { calls++; assert.equal(signal.aborted, false); view.abort(); return { documents: [], nextCursor: "next" }; },
  }) } });
  await assert.rejects(repository.load(view.signal), { name: "AbortError" });
  assert.equal(calls, 1); assert.equal(generation.signal.aborted, false);
});
