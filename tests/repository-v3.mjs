import test from "node:test";
import assert from "node:assert/strict";
import { PlanningRepository } from "../web/planning-repository.js";
const collectionIds = ["planning_items", "planning_flow_links", "planning_references", "planning_consequences", "dm_notes", "planning_views"];
const dataRevisions = collectionIds.map(dataId => ({ kind: "collection", dataId, revision: 0 }));
const receipt = mutations => ({ results: mutations.map(mutation => ({ dataId: mutation.dataId, key: mutation.key, afterRevision: mutation.expectedRevision + 1, deleted: mutation.operation === 'delete' })) });
import { validatePlanning } from "../web/planning-model.js";

test("moving a container changes only its record and retains the draft revision and collection guards", async () => {
  const writes = [];
  const repository = new PlanningRepository({ signal: new AbortController().signal, data: {
    collection: () => ({}), transact: async (mutations, options) => writes.push({ mutations, options }),
  } });
  const quest = validQuest(), target = { ...quest, id: "destination", title: "Destination" };
  const child = { ...quest, id: "child", parentId: quest.id };
  const snapshot = { items: [quest, target, child], flows: [], references: [{ id: "ref", itemId: target.id, target: { scope: "planning", itemId: quest.id } }],
    notes: [{ id: "note", anchorIds: [quest.id, child.id] }], consequences: [{ id: "effect", anchor: { scope: "item", itemId: quest.id } }],
    views: [{ id: "scope-root", positions: { [quest.id]: { x: 24, y: 48 } } }], dataRevisions, revisions: new Map([[`planning_items:${quest.id}`, 9]]) };
  const original = structuredClone(snapshot), next = { ...quest, parentId: target.id, kind: "plotline" };
  await repository.saveItem(snapshot, next, 7);
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].options.expectedDataSets, dataRevisions);
  assert.deepEqual(writes[0].mutations, [{ operation: "put", kind: "collection", dataId: "planning_items", key: quest.id, expectedRevision: 7, value: next }]);
  assert.deepEqual(snapshot, original);
  await assert.rejects(repository.saveItem(snapshot, { ...quest, parentId: child.id }, 7), /cycle/);
  await assert.rejects(repository.saveItem(snapshot, { ...quest, kind: "event" }, 7), /children first/);
  assert.equal(writes.length, 1);
});

test("repository loads all declared collections and keeps exact revisions", async () => {
  const calls = [];
  const context = {
    signal: new AbortController().signal,
    data: {
      collection: id => ({
        query: async () => { calls.push(id); return { dataRevision: 12, documents: id === "planning_items" ? [{ key: "quest-a", revision: 7, value: validQuest() }] : [] }; },
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
      transact: async value => { mutations = value; return receipt(value); },
    },
  };
  const repository = new PlanningRepository(context);
  const quest = validQuest(); const event = { ...validQuest(), id: "event-a", kind: "event", parentId: "quest-a", eventType: "story" };
  const sibling = { ...validQuest(), id: "quest-b", title: "Quest B" };
  const note = { id: "note-a", schemaVersion: 3, title: "Shared note", body: "", anchorIds: ["quest-a", "quest-b"], updatedAt: 1 };
  const snapshot = { dataRevisions, items: [quest, event, sibling], flows: [], references: [], consequences: [], notes: [note], views: [], revisions: new Map([["planning_items:quest-a", 2], ["planning_items:event-a", 3], ["planning_items:quest-b", 4], ["dm_notes:note-a", 5]]) };
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
    consequences: [{ id: "flow-consequence", anchor: { scope: "flow", flowId: "flow-a" } }, { id: "item-consequence", schemaVersion: 3, kind: "information", title: "The secret remains", body: "Authored explanation\nKeep exactly.", updatedAt: 1, anchor: { scope: "item", itemId: "quest-b" }, target: { scope: "planning", itemId: "event-a" } }],
    notes: [{ id: "shared-note", anchorIds: ["event-a", "quest-b"], title: "Shared", body: "Keep me" }],
    views: [{ id: "scope-root", schemaVersion: 3, scopeId: null, positions: { "quest-a": { x: 24, y: 24 }, "quest-b": { x: 300, y: 24 } }, updatedAt: 1 },
      { id: "scope-quest-a", schemaVersion: 3, scopeId: "quest-a", positions: { "event-a": { x: 48, y: 48 } }, updatedAt: 1 }],
    dataRevisions, revisions: new Map(),
  };
  const collections = { items: "planning_items", flows: "planning_flow_links", references: "planning_references", consequences: "planning_consequences", notes: "dm_notes", views: "planning_views" };
  for (const [key, collection] of Object.entries(collections)) for (const record of dataset[key]) dataset.revisions.set(`${collection}:${record.id}`, dataset.revisions.size + 1);
  const writes = [];
  const repository = new PlanningRepository({ signal: new AbortController().signal, data: { collection: () => ({}), transact: async mutations => { writes.push(mutations); return receipt(mutations); } } });
  return { dataset, repository, writes, collections };
}

function applyWrites(snapshot, mutations, collections) {
  const next = structuredClone(snapshot);
  for (const mutation of mutations) {
    const field = Object.keys(collections).find(key => collections[key] === mutation.dataId), key = `${mutation.dataId}:${mutation.key}`;
    next[field] = next[field].filter(value => value.id !== mutation.key);
    if (mutation.operation === 'put') { next[field].push(structuredClone(mutation.value)); next.revisions.set(key, mutation.expectedRevision + 1); }
    else next.revisions.delete(key);
  }
  return next;
}

test('undo restores the complete deletion using receipt revisions and retains unrelated later edits', async () => {
  const { dataset, repository, writes, collections } = deletionFixture();
  for (const key of Object.keys(collections)) for (const value of dataset[key]) value.updatedAt = 1;
  const before = structuredClone(dataset), undo = await repository.deleteSubtree(dataset, 'quest-a');
  const after = applyWrites(dataset, writes[0], collections);
  after.items.find(item => item.id === 'quest-b').title = 'Unrelated newer title'; after.revisions.set('planning_items:quest-b', 55);
  await repository.undoDeletion(after, undo);
  assert.equal(writes.length, 2); assert.equal(writes[1].length, writes[0].length);
  for (const inverse of writes[1]) {
    const deleted = writes[0].find(value => value.dataId === inverse.dataId && value.key === inverse.key);
    assert.equal(inverse.operation, 'put'); assert.equal(inverse.expectedRevision, deleted.expectedRevision + 1);
    assert.ok(inverse.value.updatedAt > 1);
  }
  const restored = applyWrites(after, writes[1], collections);
  assert.equal(restored.items.find(item => item.id === 'quest-b').title, 'Unrelated newer title');
  for (const field of ['flows', 'references', 'consequences', 'notes', 'views']) {
    const content = values => values.map(({ updatedAt, ...value }) => value).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(content(restored[field]), content(before[field]));
  }
  assert.deepEqual(validatePlanning(restored), []); assert.deepEqual(dataset, before);
});

test('undo refuses changed shared records and invalid restored ownership before publishing', async () => {
  for (const conflict of ['note', 'consequence', 'parent']) {
    const { dataset, repository, writes, collections } = deletionFixture();
    const undo = await repository.deleteSubtree(dataset, 'event-a'), after = applyWrites(dataset, writes[0], collections);
    if (conflict === 'note') after.revisions.set('dm_notes:shared-note', 100);
    else if (conflict === 'consequence') after.revisions.set('planning_consequences:item-consequence', 100);
    else after.items = after.items.filter(item => item.id !== 'quest-a');
    await assert.rejects(repository.undoDeletion(after, undo), conflict !== 'parent' ? /changed after deletion/ : /missing parent/);
    assert.equal(writes.length, 1);
  }
});

test('an incomplete deletion receipt never invents undo revisions', async () => {
  const { dataset } = deletionFixture();
  let calls = 0;
  const repository = new PlanningRepository({ signal: new AbortController().signal, data: { collection: () => ({}), transact: async () => { calls++; return { results: [] }; } } });
  await assert.rejects(repository.deleteSubtree(dataset, 'quest-a'), /undo receipt is incomplete/); assert.equal(calls, 1);
});

test('reset clears only the active layout and retains its revision for the next drag', async () => {
  const { dataset, repository, writes, collections } = deletionFixture(), before = structuredClone(dataset);
  await repository.resetLayout(dataset, null);
  assert.equal(writes[0].length, 1); assert.equal(writes[0][0].key, 'scope-root'); assert.deepEqual(writes[0][0].value.positions, {});
  const after = applyWrites(dataset, writes[0], collections); await repository.savePosition(after, null, 'quest-a', 48, 72);
  assert.equal(writes[1][0].expectedRevision, writes[0][0].expectedRevision + 1);
  assert.deepEqual(writes[1][0].value.positions, { 'quest-a': { x: 48, y: 72 } });
  assert.deepEqual(after.views.find(view => view.scopeId === 'quest-a'), before.views.find(view => view.scopeId === 'quest-a'));
  assert.deepEqual(dataset, before);
});

test('creation validates ownership and duplicate IDs before a revision-zero write', async () => {
  const { dataset, repository, writes } = deletionFixture();
  await assert.rejects(repository.createItem(dataset, validQuest()), /Duplicate/);
  await assert.rejects(repository.createItem(dataset, { ...validQuest(), id: 'new', parentId: 'absent' }), /missing parent/);
  assert.equal(writes.length, 0);
  await repository.createItem(dataset, { ...validQuest(), id: 'new', parentId: 'quest-a' });
  assert.equal(writes[0].length, 1); assert.equal(writes[0][0].expectedRevision, 0);
});

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
  const { target, updatedAt, ...prose } = dataset.consequences[1];
  assert.deepEqual(remaining.consequences[0], { ...prose, updatedAt: remaining.consequences[0].updatedAt });
  assert.ok(remaining.consequences[0].updatedAt > updatedAt);
  assert.equal(Object.hasOwn(remaining.consequences[0], "target"), false);
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


test("paginated loads pin the first revision and refuse missing or changed revisions", async () => {
  for (const nextRevision of [undefined, 5, 4]) {
    const calls = [];
    const repository = new PlanningRepository({ signal: new AbortController().signal, data: { collection: id => ({ query: async options => {
      if (id !== "planning_items") return { documents: [], dataRevision: 0 };
      calls.push(options);
      return options.cursor ? { documents: [], dataRevision: nextRevision } : { documents: [], dataRevision: 4, nextCursor: "next" };
    } }) } });
    if (nextRevision === 4) assert.equal((await repository.load()).dataRevisions[0].revision, 4);
    else await assert.rejects(repository.load(), /revision|changed/);
    assert.equal(calls[0].includeDataRevision, true); assert.equal(calls[1].expectedDataRevision, 4);
  }
});

test("all writes retain the validated snapshot including empty collections", async () => {
  const writes = [];
  const repository = new PlanningRepository({ signal: new AbortController().signal, data: {
    collection: () => ({ query: async () => ({ documents: [], dataRevision: 0 }) }),
    transact: async (mutations, options) => { writes.push({ mutations, options }); },
  } });
  const snapshot = await repository.load();
  await repository.put(snapshot, "planning_items", validQuest(), 7);
  await repository.savePosition({ ...snapshot, items: [validQuest()] }, null, "quest-a", 20, 30);
  for (const write of writes) assert.deepEqual(write.options.expectedDataSets, dataRevisions);
  assert.equal(writes[0].mutations[0].expectedRevision, 7);
  await assert.rejects(repository.put({ ...snapshot, dataRevisions: [] }, "planning_items", validQuest(), 0), /revisions are missing/);
  assert.equal(writes.length, 2);
});

test("group deletion unions overlapping subtrees and explicit flows without duplicate writes", async () => {
  const { dataset, repository, writes } = deletionFixture();
  await repository.deleteSelection(dataset, ['quest-a', 'event-a', 'quest-a'], ['flow-a']);
  assert.equal(writes.length, 1);
  const keys = writes[0].map(mutation => `${mutation.dataId}:${mutation.key}`);
  assert.equal(keys.length, new Set(keys).size);
  assert.deepEqual(writes[0].find(mutation => mutation.key === 'shared-note').value.anchorIds, ['quest-b']);
  assert.ok(!keys.includes('planning_items:quest-b'));
  await assert.rejects(repository.deleteSelection(dataset, ['missing'], []), /no longer exists/);
  await assert.rejects(repository.deleteSelection(dataset, [], ['missing']), /no longer exists/);
  assert.equal(writes.length, 1);
});

test("group moves preserve spacing and untouched positions in one guarded layout write", async () => {
  const { dataset, repository, writes } = deletionFixture();
  const original = structuredClone(dataset);
  await repository.savePositions(dataset, null, { 'quest-a': { x: -24, y: 24 }, 'quest-b': { x: 252, y: 24 } });
  assert.equal(writes.length, 1); assert.equal(writes[0].length, 1);
  assert.deepEqual(writes[0][0].value.positions, { 'quest-a': { x: -24, y: 24 }, 'quest-b': { x: 252, y: 24 } });
  assert.equal(writes[0][0].expectedRevision, dataset.revisions.get('planning_views:scope-root'));
  assert.deepEqual(dataset, original);
  await assert.rejects(repository.savePositions(dataset, null, { 'event-a': { x: 0, y: 0 } }), /Only items on this canvas/);
  await assert.rejects(repository.savePositions(dataset, null, { 'quest-a': { x: Infinity, y: 0 } }), /finite/);
  assert.equal(writes.length, 1);
});

test("deletion clears incoming consequence targets on surviving flows and leaves foreign targets intact", async () => {
  const { dataset, repository, writes, collections } = deletionFixture();
  const base = dataset.consequences[1];
  dataset.consequences = [
    { ...base, anchor: { scope: "flow", flowId: "flow-a" } },
    { ...base, id: "core-effect", target: { scope: "core", collection: "events", id: "event-a" } },
    { ...base, id: "external-effect", target: { scope: "external", addonId: "other", kind: "event", id: "event-a", label: "External" } },
  ];
  for (const effect of dataset.consequences) dataset.revisions.set('planning_consequences:' + effect.id, 4);
  const before = structuredClone(dataset);
  const undo = await repository.deleteSubtree(dataset, "event-a");
  const changes = writes[0].filter(mutation => mutation.dataId === "planning_consequences");
  assert.equal(changes.length, 1); assert.equal(changes[0].key, base.id);
  assert.equal(changes[0].operation, "put"); assert.equal(changes[0].expectedRevision, 4);
  const after = applyWrites(dataset, writes[0], collections);
  assert.deepEqual(validatePlanning(after), []);
  await repository.undoDeletion(after, undo);
  const restored = applyWrites(after, writes[1], collections);
  assert.deepEqual(restored.consequences.find(value => value.id === base.id).target, base.target);
  assert.deepEqual(dataset, before);
});

test("a stale consequence cleanup is rejected with all collection guards and no retry", async () => {
  const { dataset } = deletionFixture();
  const before = structuredClone(dataset), calls = [];
  const repository = new PlanningRepository({ signal: new AbortController().signal, data: { collection: () => ({}), transact: async (mutations, options) => {
    calls.push({ mutations, options }); throw new Error("data changed");
  } } });
  await assert.rejects(repository.deleteSubtree(dataset, "event-a"), /data changed/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.expectedDataSets, dataset.dataRevisions);
  const consequence = calls[0].mutations.find(value => value.dataId === "planning_consequences");
  assert.equal(consequence.expectedRevision, dataset.revisions.get("planning_consequences:item-consequence"));
  assert.equal(Object.hasOwn(consequence.value, "target"), false);
  assert.deepEqual(dataset, before);
});

test("stored dangling consequence targets fail visibly without rewriting or hiding the annotation", async () => {
  const { dataset, collections } = deletionFixture();
  dataset.items = dataset.items.filter(item => item.id !== "event-a"); dataset.references = []; dataset.notes = [];
  const before = structuredClone(dataset);
  const repository = new PlanningRepository({ signal: new AbortController().signal, data: { collection: collection => ({ query: async () => ({ dataRevision: 1,
    documents: dataset[Object.keys(collections).find(key => collections[key] === collection)].map(value => ({ key: value.id, value, revision: 1 })),
  }) }), transact: async () => assert.fail("load must not write") } });
  await assert.rejects(repository.load(), /Consequence item-consequence has a missing planning target/);
  assert.deepEqual(dataset, before);
});
