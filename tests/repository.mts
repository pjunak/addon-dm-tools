import test from "node:test";
import assert from "node:assert/strict";
import { PlanningRepository } from "#web/planning-repository";
import type { PlanningRecord } from "#web/planning-repository";
import { validatePlanning } from "#web/planning-model";
import type {
  DmNote,
  PlanningConsequence,
  PlanningFlow,
  PlanningItem,
  PlanningReference,
  PlanningView,
} from "#web/planning-model";
import type { AddonContext, CollectionHandle, DataMutation, DataSetRevision } from "#web/sdk";

type CollectionField = "items" | "flows" | "references" | "consequences" | "notes" | "views";
type CollectionFixtures = {
  items: PlanningItem[];
  flows: PlanningFlow[];
  references: PlanningReference[];
  consequences: PlanningConsequence[];
  notes: DmNote[];
  views: PlanningView[];
};
type FixtureSnapshot = CollectionFixtures & {
  dataRevisions: DataSetRevision[];
  revisions: Map<string, number>;
};
type FixtureMutation = DataMutation;
type TransactionOptions = NonNullable<Parameters<AddonContext["data"]["transact"]>[1]>;
type CapturedWrite = { mutations: readonly FixtureMutation[]; options: TransactionOptions };
type QueryOptions = NonNullable<Parameters<CollectionHandle<PlanningRecord>["query"]>[0]>;

function mutationValue<Record extends PlanningRecord>(
  mutations: readonly FixtureMutation[],
  key: string,
  guard: (value: unknown) => value is Record,
): Record {
  const mutation = mutations.find((entry) => entry.key === key);
  assert.ok(mutation);
  assert.equal(mutation.operation, "put");
  assert.ok(guard(mutation.value));
  return mutation.value;
}

function requiredRecord<Record extends { readonly id: string }>(
  records: readonly Record[],
  id: string,
): Record {
  const record = records.find((entry) => entry.id === id);
  assert.ok(record);
  return record;
}

function isPlanningRecord(value: unknown): value is PlanningRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "schemaVersion" in value &&
    value.schemaVersion === 3
  );
}

const unusedCollection = () => ({
  query: async () => assert.fail("collection query is not used by this test"),
});

function collectionField(
  collections: Readonly<Record<CollectionField, string>>,
  dataId: string,
): CollectionField {
  const field = (Object.keys(collections) as CollectionField[]).find(
    (candidate) => collections[candidate] === dataId,
  );
  assert.ok(field);
  return field;
}

const collectionIds = [
  "planning_items",
  "planning_flow_links",
  "planning_references",
  "planning_consequences",
  "dm_notes",
  "planning_views",
] as const;
const dataRevisions: FixtureSnapshot["dataRevisions"] = collectionIds.map((dataId) => ({
  kind: "collection",
  dataId,
  revision: 0,
}));
const receipt = (mutations: readonly FixtureMutation[]) => ({
  results: mutations.map((mutation) => ({
    dataId: mutation.dataId,
    key: mutation.key,
    afterRevision: mutation.expectedRevision + 1,
    deleted: mutation.operation === "delete",
  })),
});

void test("moving a container changes only its record and retains the draft revision and collection guards", async () => {
  const writes: CapturedWrite[] = [];
  const repository = new PlanningRepository({
    signal: new AbortController().signal,
    data: {
      collection: unusedCollection,
      transact: async (mutations, options) => {
        assert.ok(options);
        writes.push({ mutations: [...mutations], options });
        return receipt(mutations);
      },
    },
  });
  const quest = validQuest(),
    target = { ...quest, id: "destination", title: "Destination" };
  const child = { ...quest, id: "child", parentId: quest.id };
  const snapshot: FixtureSnapshot = {
    items: [quest, target, child],
    flows: [],
    references: [
      validReference({
        id: "ref",
        itemId: target.id,
        target: { scope: "planning", itemId: quest.id },
      }),
    ],
    notes: [validNote({ id: "note", anchorIds: [quest.id, child.id] })],
    consequences: [validConsequence({ id: "effect", anchor: { scope: "item", itemId: quest.id } })],
    views: [validView({ id: "scope-root", positions: { [quest.id]: { x: 24, y: 48 } } })],
    dataRevisions,
    revisions: new Map([[`planning_items:${quest.id}`, 9]]),
  };
  const original = structuredClone(snapshot),
    next: PlanningItem = { ...quest, parentId: target.id, kind: "plotline" };
  await repository.saveItem(snapshot, next, 7);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].options.expectedDataSets, dataRevisions);
  assert.deepEqual(writes[0].mutations, [
    {
      operation: "put",
      kind: "collection",
      dataId: "planning_items",
      key: quest.id,
      expectedRevision: 7,
      value: next,
    },
  ]);
  assert.deepEqual(snapshot, original);
  await assert.rejects(repository.saveItem(snapshot, { ...quest, parentId: child.id }, 7), /cycle/);
  await assert.rejects(
    repository.saveItem(snapshot, { ...quest, kind: "event" }, 7),
    /children first/,
  );
  assert.equal(writes.length, 1);
});

void test("repository loads all declared collections and keeps exact revisions", async () => {
  const calls: string[] = [];
  const context = {
    signal: new AbortController().signal,
    data: {
      collection: (id: string) => ({
        query: async () => {
          calls.push(id);
          return {
            dataRevision: 12,
            documents:
              id === "planning_items" ? [{ key: "quest-a", revision: 7, value: validQuest() }] : [],
          };
        },
        put: async () => assert.fail("not used"),
        delete: async () => assert.fail("not used"),
      }),
      transact: async () => assert.fail("not used"),
    },
  };
  const snapshot = await new PlanningRepository(context).load();
  assert.equal(calls.length, 6);
  assert.equal(snapshot.items[0].id, "quest-a");
  assert.equal(snapshot.revisions.get("planning_items:quest-a"), 7);
});

void test("subtree deletion publishes one explicit cross-collection transaction", async () => {
  let mutations: readonly FixtureMutation[] = [];
  const context = {
    signal: new AbortController().signal,
    data: {
      collection: unusedCollection,
      transact: async (value: readonly DataMutation[]) => {
        mutations = [...value];
        return receipt(value);
      },
    },
  };
  const repository = new PlanningRepository(context);
  const quest = validQuest();
  const event: PlanningItem = {
    ...validQuest(),
    id: "event-a",
    kind: "event",
    parentId: "quest-a",
    eventType: "story",
  };
  const sibling = { ...validQuest(), id: "quest-b", title: "Quest B" };
  const note: DmNote = {
    id: "note-a",
    schemaVersion: 3,
    title: "Shared note",
    body: "",
    anchorIds: ["quest-a", "quest-b"],
    updatedAt: 1,
  };
  const snapshot: FixtureSnapshot = {
    dataRevisions,
    items: [quest, event, sibling],
    flows: [],
    references: [],
    consequences: [],
    notes: [note],
    views: [],
    revisions: new Map([
      ["planning_items:quest-a", 2],
      ["planning_items:event-a", 3],
      ["planning_items:quest-b", 4],
      ["dm_notes:note-a", 5],
    ]),
  };
  await repository.deleteSubtree(snapshot, "quest-a");
  assert.deepEqual(
    mutations.map((entry) => [entry.operation, entry.dataId, entry.key, entry.expectedRevision]),
    [
      ["delete", "planning_items", "quest-a", 2],
      ["delete", "planning_items", "event-a", 3],
      ["put", "dm_notes", "note-a", 5],
    ],
  );
  assert.deepEqual(mutationValue(mutations, "note-a", isDmNote).anchorIds, ["quest-b"]);
});

function validQuest(): PlanningItem {
  return {
    id: "quest-a",
    schemaVersion: 3,
    kind: "quest",
    parentId: null,
    title: "Quest A",
    summary: "",
    body: "",
    objective: "",
    setup: "",
    resolution: "",
    tags: [],
    updatedAt: 1,
  };
}

function validReference(overrides: Partial<PlanningReference>): PlanningReference {
  return {
    id: "reference",
    schemaVersion: 3,
    itemId: "quest-a",
    name: "Reference",
    relation: "related",
    target: {},
    quantity: 1,
    notes: "",
    updatedAt: 1,
    ...overrides,
  };
}

function validConsequence(overrides: Partial<PlanningConsequence>): PlanningConsequence {
  return {
    id: "consequence",
    schemaVersion: 3,
    anchor: { scope: "item", itemId: "quest-a" },
    kind: "information",
    title: "Consequence",
    body: "",
    updatedAt: 1,
    ...overrides,
  };
}

function validNote(overrides: Partial<DmNote>): DmNote {
  return {
    id: "note",
    schemaVersion: 3,
    title: "Note",
    body: "",
    anchorIds: [],
    updatedAt: 1,
    ...overrides,
  };
}

function validView(overrides: Partial<PlanningView>): PlanningView {
  return {
    id: "scope-root",
    schemaVersion: 3,
    scopeId: null,
    positions: {},
    updatedAt: 1,
    ...overrides,
  };
}

function deletionFixture() {
  const dataset: FixtureSnapshot = {
    items: [
      validQuest(),
      { ...validQuest(), id: "quest-b" },
      { ...validQuest(), id: "event-a", kind: "event", eventType: "story", parentId: "quest-a" },
    ],
    flows: [
      {
        id: "flow-a",
        schemaVersion: 3,
        sourceId: "quest-a",
        targetId: "quest-b",
        kind: "continues",
        label: "Passage",
        updatedAt: 1,
      },
    ],
    references: [
      validReference({
        id: "ref-a",
        itemId: "quest-b",
        target: { scope: "planning", itemId: "event-a" },
      }),
    ],
    consequences: [
      validConsequence({ id: "flow-consequence", anchor: { scope: "flow", flowId: "flow-a" } }),
      validConsequence({
        id: "item-consequence",
        title: "The secret remains",
        body: "Authored explanation\nKeep exactly.",
        anchor: { scope: "item", itemId: "quest-b" },
        target: { scope: "planning", itemId: "event-a" },
      }),
    ],
    notes: [
      validNote({
        id: "shared-note",
        anchorIds: ["event-a", "quest-b"],
        title: "Shared",
        body: "Keep me",
      }),
    ],
    views: [
      {
        id: "scope-root",
        schemaVersion: 3,
        scopeId: null,
        positions: { "quest-a": { x: 24, y: 24 }, "quest-b": { x: 300, y: 24 } },
        updatedAt: 1,
      },
      {
        id: "scope-quest-a",
        schemaVersion: 3,
        scopeId: "quest-a",
        positions: { "event-a": { x: 48, y: 48 } },
        updatedAt: 1,
      },
    ],
    dataRevisions,
    revisions: new Map(),
  };
  const collections: Record<CollectionField, string> = {
    items: "planning_items",
    flows: "planning_flow_links",
    references: "planning_references",
    consequences: "planning_consequences",
    notes: "dm_notes",
    views: "planning_views",
  };
  for (const [key, collection] of Object.entries(collections) as Array<[CollectionField, string]>)
    for (const record of dataset[key])
      dataset.revisions.set(`${collection}:${record.id}`, dataset.revisions.size + 1);
  const writes: FixtureMutation[][] = [];
  const repository = new PlanningRepository({
    signal: new AbortController().signal,
    data: {
      collection: unusedCollection,
      transact: async (mutations) => {
        writes.push([...mutations]);
        return receipt(mutations);
      },
    },
  });
  return { dataset, repository, writes, collections };
}

function applyWrites(
  snapshot: FixtureSnapshot,
  mutations: readonly FixtureMutation[],
  collections: Record<CollectionField, string>,
): FixtureSnapshot {
  const next = structuredClone(snapshot);
  for (const mutation of mutations) {
    const field = (Object.keys(collections) as CollectionField[]).find(
        (key) => collections[key] === mutation.dataId,
      ),
      key = `${mutation.dataId}:${mutation.key}`;
    assert.ok(field);
    replaceRecord(
      next,
      field,
      mutation.key,
      mutation.operation === "put" ? mutation.value : undefined,
    );
    if (mutation.operation === "put") next.revisions.set(key, mutation.expectedRevision + 1);
    else next.revisions.delete(key);
  }
  return next;
}

function replaceRecord(
  snapshot: FixtureSnapshot,
  field: CollectionField,
  key: string,
  value: unknown,
): void {
  const append = <Record extends PlanningRecord>(
    records: Record[],
    guard: (value: unknown) => value is Record,
  ) => {
    const retained = records.filter((record) => record.id !== key);
    if (value !== undefined) {
      assert.ok(guard(value));
      retained.push(structuredClone(value));
    }
    return retained;
  };
  switch (field) {
    case "items":
      snapshot.items = append(snapshot.items, isPlanningItem);
      break;
    case "flows":
      snapshot.flows = append(snapshot.flows, isPlanningFlow);
      break;
    case "references":
      snapshot.references = append(snapshot.references, isPlanningReference);
      break;
    case "consequences":
      snapshot.consequences = append(snapshot.consequences, isPlanningConsequence);
      break;
    case "notes":
      snapshot.notes = append(snapshot.notes, isDmNote);
      break;
    case "views":
      snapshot.views = append(snapshot.views, isPlanningView);
      break;
  }
}

function isPlanningItem(value: unknown): value is PlanningItem {
  return isPlanningRecord(value) && "parentId" in value;
}
function isPlanningFlow(value: unknown): value is PlanningFlow {
  return isPlanningRecord(value) && "sourceId" in value && "targetId" in value;
}
function isPlanningReference(value: unknown): value is PlanningReference {
  return isPlanningRecord(value) && "itemId" in value && "quantity" in value;
}
function isPlanningConsequence(value: unknown): value is PlanningConsequence {
  return isPlanningRecord(value) && "anchor" in value && "kind" in value;
}
function isDmNote(value: unknown): value is DmNote {
  return isPlanningRecord(value) && "anchorIds" in value;
}
function isPlanningView(value: unknown): value is PlanningView {
  return isPlanningRecord(value) && "scopeId" in value && "positions" in value;
}

void test("undo restores the complete deletion using receipt revisions and retains unrelated later edits", async () => {
  const { dataset, repository, writes, collections } = deletionFixture();
  const before = structuredClone(dataset),
    undo = await repository.deleteSubtree(dataset, "quest-a");
  assert.ok(undo);
  const after = applyWrites(dataset, writes[0], collections);
  const laterQuest = after.items.find((item) => item.id === "quest-b");
  assert.ok(laterQuest);
  after.items = after.items.map((item) =>
    item.id === laterQuest.id ? { ...item, title: "Unrelated newer title" } : item,
  );
  after.revisions.set("planning_items:quest-b", 55);
  await repository.undoDeletion(after, undo);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].length, writes[0].length);
  for (const inverse of writes[1]) {
    const deleted = writes[0].find(
      (value) => value.dataId === inverse.dataId && value.key === inverse.key,
    );
    if (inverse.operation !== "put") assert.fail("undo must restore records with put mutations");
    assert.ok(deleted);
    assert.equal(inverse.expectedRevision, deleted.expectedRevision + 1);
    assert.ok(isPlanningRecord(inverse.value));
    assert.ok(inverse.value.updatedAt > 1);
  }
  const restored = applyWrites(after, writes[1], collections);
  assert.equal(requiredRecord(restored.items, "quest-b").title, "Unrelated newer title");
  for (const field of ["flows", "references", "consequences", "notes", "views"]) {
    const content = (values: PlanningRecord[]) =>
      values
        .map(({ updatedAt: _updatedAt, ...value }) => value)
        .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(
      content(restored[field as CollectionField]),
      content(before[field as CollectionField]),
    );
  }
  assert.deepEqual(validatePlanning(restored), []);
  assert.deepEqual(dataset, before);
});

void test("undo refuses changed shared records and invalid restored ownership before publishing", async () => {
  for (const conflict of ["note", "consequence", "parent"]) {
    const { dataset, repository, writes, collections } = deletionFixture();
    const undo = await repository.deleteSubtree(dataset, "event-a"),
      after = applyWrites(dataset, writes[0], collections);
    assert.ok(undo);
    if (conflict === "note") after.revisions.set("dm_notes:shared-note", 100);
    else if (conflict === "consequence")
      after.revisions.set("planning_consequences:item-consequence", 100);
    else after.items = after.items.filter((item) => item.id !== "quest-a");
    await assert.rejects(
      repository.undoDeletion(after, undo),
      conflict !== "parent" ? /changed after deletion/ : /missing parent/,
    );
    assert.equal(writes.length, 1);
  }
});

void test("an incomplete deletion receipt never invents undo revisions", async () => {
  const { dataset } = deletionFixture();
  let calls = 0;
  const repository = new PlanningRepository({
    signal: new AbortController().signal,
    data: {
      collection: unusedCollection,
      transact: async () => {
        calls++;
        return { results: [] };
      },
    },
  });
  await assert.rejects(repository.deleteSubtree(dataset, "quest-a"), /undo receipt is incomplete/);
  assert.equal(calls, 1);
});

void test("reset clears only the active layout and retains its revision for the next drag", async () => {
  const { dataset, repository, writes, collections } = deletionFixture(),
    before = structuredClone(dataset);
  await repository.resetLayout(dataset, null);
  assert.equal(writes[0].length, 1);
  assert.equal(writes[0][0].key, "scope-root");
  assert.deepEqual(mutationValue(writes[0], "scope-root", isPlanningView).positions, {});
  const after = applyWrites(dataset, writes[0], collections);
  await repository.savePositions(after, null, { "quest-a": { x: 48, y: 72 } });
  assert.equal(writes[1][0].expectedRevision, writes[0][0].expectedRevision + 1);
  assert.deepEqual(mutationValue(writes[1], "scope-root", isPlanningView).positions, {
    "quest-a": { x: 48, y: 72 },
  });
  assert.deepEqual(
    after.views.find((view) => view.scopeId === "quest-a"),
    before.views.find((view) => view.scopeId === "quest-a"),
  );
  assert.deepEqual(dataset, before);
});

void test("creation validates ownership and duplicate IDs before a revision-zero write", async () => {
  const { dataset, repository, writes } = deletionFixture();
  await assert.rejects(repository.createItem(dataset, validQuest()), /Duplicate/);
  await assert.rejects(
    repository.createItem(dataset, { ...validQuest(), id: "new", parentId: "absent" }),
    /missing parent/,
  );
  assert.equal(writes.length, 0);
  await repository.createItem(dataset, { ...validQuest(), id: "new", parentId: "quest-a" });
  assert.equal(writes[0].length, 1);
  assert.equal(writes[0][0].expectedRevision, 0);
});

void test("deleting a flow atomically removes its consequences without deleting endpoint annotations", async () => {
  const { dataset, repository, writes } = deletionFixture();
  await repository.deleteFlow(dataset, "flow-a");
  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0].map((entry) => [entry.operation, entry.dataId, entry.key]),
    [
      ["delete", "planning_flow_links", "flow-a"],
      ["delete", "planning_consequences", "flow-consequence"],
    ],
  );
  for (const mutation of writes[0])
    assert.equal(
      mutation.expectedRevision,
      dataset.revisions.get(`${mutation.dataId}:${mutation.key}`),
    );
});

void test("subtree deletion cleans incoming planning references and saved positions while retaining shared notes", async () => {
  const { dataset, repository, writes, collections } = deletionFixture();
  await repository.deleteSubtree(dataset, "quest-a");
  assert.equal(writes.length, 1);
  const mutations = writes[0];
  assert.ok(mutations.some((entry) => entry.operation === "delete" && entry.key === "ref-a"));
  assert.ok(
    mutations.some((entry) => entry.operation === "delete" && entry.key === "scope-quest-a"),
  );
  const shared = mutationValue(mutations, "shared-note", isDmNote);
  assert.deepEqual(shared.anchorIds, ["quest-b"]);
  assert.equal(shared.body, "Keep me");
  const rootView = mutationValue(mutations, "scope-root", isPlanningView);
  assert.deepEqual(rootView.positions, { "quest-b": { x: 300, y: 24 } });
  const remaining = applyWrites(dataset, mutations, collections);
  assert.deepEqual(validatePlanning(remaining), []);
  assert.deepEqual(
    remaining.consequences.map((record) => record.id),
    ["item-consequence"],
  );
  const originalConsequence = requiredRecord(dataset.consequences, "item-consequence");
  const { target: _target, updatedAt, ...prose } = originalConsequence;
  const remainingConsequence = requiredRecord(remaining.consequences, "item-consequence");
  assert.deepEqual(remainingConsequence, {
    ...prose,
    updatedAt: remainingConsequence.updatedAt,
  });
  assert.ok(
    updatedAt !== undefined &&
      remainingConsequence.updatedAt !== undefined &&
      remainingConsequence.updatedAt > updatedAt,
  );
  assert.equal(Object.hasOwn(remainingConsequence, "target"), false);
});

void test("deletion refuses missing revisions or oversized transactions before publishing any writes", async () => {
  const { dataset, repository, writes } = deletionFixture();
  dataset.revisions.delete("planning_consequences:flow-consequence");
  await assert.rejects(repository.deleteFlow(dataset, "flow-a"), /revision is missing/);
  assert.equal(writes.length, 0);
  dataset.consequences = Array.from({ length: 256 }, (_, index) =>
    validConsequence({
      id: `consequence-${index}`,
      anchor: { scope: "flow", flowId: "flow-a" },
    }),
  );
  for (const consequence of dataset.consequences)
    dataset.revisions.set(`planning_consequences:${consequence.id}`, 1);
  await assert.rejects(repository.deleteFlow(dataset, "flow-a"), /more than 256/);
  assert.equal(writes.length, 0);
});

void test("leaving a view aborts paginated reads without stopping its activation generation", async () => {
  const generation = new AbortController(),
    view = new AbortController();
  let calls = 0;
  const repository = new PlanningRepository({
    signal: generation.signal,
    data: {
      collection: () => ({
        query: async ({ signal }: { signal: AbortSignal }) => {
          calls++;
          assert.equal(signal.aborted, false);
          view.abort();
          return { documents: [], nextCursor: "next" };
        },
      }),
      transact: async () => assert.fail("load must not write"),
    },
  });
  await assert.rejects(repository.load(view.signal), { name: "AbortError" });
  assert.equal(calls, 1);
  assert.equal(generation.signal.aborted, false);
});

void test("paginated loads pin the first revision and refuse missing or changed revisions", async () => {
  for (const nextRevision of [undefined, 5, 4]) {
    const calls: QueryOptions[] = [];
    const repository = new PlanningRepository({
      signal: new AbortController().signal,
      data: {
        collection: (id: string) => ({
          query: async (options: QueryOptions) => {
            if (id !== "planning_items") return { documents: [], dataRevision: 0 };
            calls.push(options);
            if (!options.cursor) return { documents: [], dataRevision: 4, nextCursor: "next" };
            return nextRevision === undefined
              ? { documents: [] }
              : { documents: [], dataRevision: nextRevision };
          },
        }),
        transact: async () => assert.fail("load must not write"),
      },
    });
    if (nextRevision === 4) assert.equal((await repository.load()).dataRevisions[0].revision, 4);
    else await assert.rejects(repository.load(), /revision|changed/);
    assert.equal(calls[0].includeDataRevision, true);
    assert.equal(calls[1].expectedDataRevision, 4);
  }
});

void test("all writes retain the validated snapshot including empty collections", async () => {
  const writes: CapturedWrite[] = [];
  const repository = new PlanningRepository({
    signal: new AbortController().signal,
    data: {
      collection: () => ({ query: async () => ({ documents: [], dataRevision: 0 }) }),
      transact: async (mutations, options) => {
        assert.ok(options);
        writes.push({ mutations: [...mutations], options });
        return receipt(mutations);
      },
    },
  });
  const snapshot = await repository.load();
  await repository.put(snapshot, "planning_items", validQuest(), 7);
  await repository.savePositions({ ...snapshot, items: [validQuest()] }, null, {
    "quest-a": { x: 20, y: 30 },
  });
  for (const write of writes) assert.deepEqual(write.options.expectedDataSets, dataRevisions);
  assert.equal(writes[0].mutations[0].expectedRevision, 7);
  await assert.rejects(
    repository.put({ ...snapshot, dataRevisions: [] }, "planning_items", validQuest(), 0),
    /revisions are missing/,
  );
  assert.equal(writes.length, 2);
});

void test("group deletion unions overlapping subtrees and explicit flows without duplicate writes", async () => {
  const { dataset, repository, writes } = deletionFixture();
  await repository.deleteSelection(dataset, ["quest-a", "event-a", "quest-a"], ["flow-a"]);
  assert.equal(writes.length, 1);
  const keys = writes[0].map((mutation) => `${mutation.dataId}:${mutation.key}`);
  assert.equal(keys.length, new Set(keys).size);
  assert.deepEqual(mutationValue(writes[0], "shared-note", isDmNote).anchorIds, ["quest-b"]);
  assert.ok(!keys.includes("planning_items:quest-b"));
  await assert.rejects(repository.deleteSelection(dataset, ["missing"], []), /no longer exists/);
  await assert.rejects(repository.deleteSelection(dataset, [], ["missing"]), /no longer exists/);
  assert.equal(writes.length, 1);
});

void test("group moves preserve spacing and untouched positions in one guarded layout write", async () => {
  const { dataset, repository, writes } = deletionFixture();
  const original = structuredClone(dataset);
  await repository.savePositions(dataset, null, {
    "quest-a": { x: -24, y: 24 },
    "quest-b": { x: 252, y: 24 },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 1);
  assert.deepEqual(mutationValue(writes[0], "scope-root", isPlanningView).positions, {
    "quest-a": { x: -24, y: 24 },
    "quest-b": { x: 252, y: 24 },
  });
  assert.equal(writes[0][0].expectedRevision, dataset.revisions.get("planning_views:scope-root"));
  assert.deepEqual(dataset, original);
  await assert.rejects(
    repository.savePositions(dataset, null, { "event-a": { x: 0, y: 0 } }),
    /Only items on this canvas/,
  );
  await assert.rejects(
    repository.savePositions(dataset, null, { "quest-a": { x: Infinity, y: 0 } }),
    /finite/,
  );
  assert.equal(writes.length, 1);
});

void test("deletion clears incoming consequence targets on surviving flows and leaves foreign targets intact", async () => {
  const { dataset, repository, writes, collections } = deletionFixture();
  const base = dataset.consequences[1];
  dataset.consequences = [
    { ...base, anchor: { scope: "flow", flowId: "flow-a" } },
    { ...base, id: "core-effect", target: { scope: "core", collection: "events", id: "event-a" } },
    {
      ...base,
      id: "external-effect",
      target: {
        scope: "external",
        addonId: "other",
        kind: "event",
        id: "event-a",
        label: "External",
      },
    },
  ];
  for (const effect of dataset.consequences)
    dataset.revisions.set("planning_consequences:" + effect.id, 4);
  const before = structuredClone(dataset);
  const undo = await repository.deleteSubtree(dataset, "event-a");
  assert.ok(undo);
  const changes = writes[0].filter((mutation) => mutation.dataId === "planning_consequences");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].key, base.id);
  assert.equal(changes[0].operation, "put");
  assert.equal(changes[0].expectedRevision, 4);
  const after = applyWrites(dataset, writes[0], collections);
  assert.deepEqual(validatePlanning(after), []);
  await repository.undoDeletion(after, undo);
  const restored = applyWrites(after, writes[1], collections);
  assert.deepEqual(requiredRecord(restored.consequences, base.id).target, base.target);
  assert.deepEqual(dataset, before);
});

void test("a stale consequence cleanup is rejected with all collection guards and no retry", async () => {
  const { dataset } = deletionFixture();
  const before = structuredClone(dataset),
    calls: CapturedWrite[] = [];
  const repository = new PlanningRepository({
    signal: new AbortController().signal,
    data: {
      collection: unusedCollection,
      transact: async (mutations, options) => {
        assert.ok(options);
        calls.push({ mutations: [...mutations], options });
        throw new Error("data changed");
      },
    },
  });
  await assert.rejects(repository.deleteSubtree(dataset, "event-a"), /data changed/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.expectedDataSets, dataset.dataRevisions);
  const consequence = calls[0].mutations.find((value) => value.dataId === "planning_consequences");
  assert.ok(consequence);
  assert.equal(
    consequence.expectedRevision,
    dataset.revisions.get("planning_consequences:item-consequence"),
  );
  if (consequence.operation !== "put") assert.fail("cleanup must update the consequence");
  assert.ok(isPlanningRecord(consequence.value));
  assert.equal(Object.hasOwn(consequence.value, "target"), false);
  assert.deepEqual(dataset, before);
});

void test("stored dangling consequence targets fail visibly without rewriting or hiding the annotation", async () => {
  const { dataset, collections } = deletionFixture();
  dataset.items = dataset.items.filter((item) => item.id !== "event-a");
  dataset.references = [];
  dataset.notes = [];
  const before = structuredClone(dataset);
  const repository = new PlanningRepository({
    signal: new AbortController().signal,
    data: {
      collection: (collection: string) => ({
        query: async () => ({
          dataRevision: 1,
          documents: dataset[collectionField(collections, collection)].map((value) => ({
            key: value.id,
            value,
            revision: 1,
          })),
        }),
      }),
      transact: async () => assert.fail("load must not write"),
    },
  });
  await assert.rejects(
    repository.load(),
    /Consequence item-consequence has a missing planning target/,
  );
  assert.deepEqual(dataset, before);
});

void test("single annotation deletes can be undone", async () => {
  const { dataset, repository, writes, collections } = deletionFixture();
  const note = dataset.notes[0];
  assert.ok(note);
  const undo = await repository.deleteRecords(dataset, [{ dataId: "dm_notes", key: note.id }]);
  assert.ok(undo);
  assert.deepEqual(
    writes[0]?.map((write) => [write.operation, write.dataId, write.key]),
    [["delete", "dm_notes", note.id]],
  );
  const after = applyWrites(dataset, writes[0]!, collections);
  assert.equal(
    after.notes.some((value) => value.id === note.id),
    false,
  );
  await repository.undoDeletion(after, undo);
  const restored = writes[1]?.[0];
  assert.equal(restored?.operation, "put");
  assert.equal(restored?.key, note.id);
});
