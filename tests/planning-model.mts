import test from "node:test";
import assert from "node:assert/strict";
import {
  availableParents,
  directChildren,
  localFlows,
  newItem,
  notesDeletedWith,
  parseTags,
  planningIssues,
  scopeViewId,
  subtreeIds,
  validateChange,
  validateItemEdit,
  validatePlanning,
} from "#web/planning-model";
import type {
  DmNote,
  PlanningConsequence,
  PlanningFlow,
  PlanningItem,
  PlanningKind,
  PlanningReference,
} from "../src/planning-model.ts";

const item = (id: string, kind: PlanningKind, parentId: string | null = null): PlanningItem => ({
  id,
  schemaVersion: 3,
  kind,
  parentId,
  title: id,
  summary: "",
  body: "",
  objective: "",
  setup: "",
  resolution: "",
  tags: [],
  updatedAt: 1,
  ...(kind === "event" ? { eventType: "story" } : {}),
  ...(kind === "branch" ? { branchType: "decision" } : {}),
});

const flow = (overrides: Partial<PlanningFlow>): PlanningFlow => ({
  id: "flow",
  schemaVersion: 3,
  sourceId: "source",
  targetId: "target",
  kind: "continues",
  label: "",
  updatedAt: 1,
  ...overrides,
});
const reference = (overrides: Partial<PlanningReference>): PlanningReference => ({
  id: "reference",
  schemaVersion: 3,
  itemId: "owner",
  name: "Reference",
  relation: "related",
  target: {},
  quantity: 1,
  notes: "",
  updatedAt: 1,
  ...overrides,
});
const consequence = (overrides: Partial<PlanningConsequence>): PlanningConsequence => ({
  id: "consequence",
  schemaVersion: 3,
  anchor: { scope: "item", itemId: "owner" },
  kind: "information",
  title: "Consequence",
  body: "",
  updatedAt: 1,
  ...overrides,
});
const note = (overrides: Partial<DmNote>): DmNote => ({
  id: "note",
  schemaVersion: 3,
  title: "Note",
  body: "",
  anchorIds: [],
  updatedAt: 1,
  ...overrides,
});

void test("parent choices omit the item, its descendants, and leaf items", () => {
  const items = [
    item("plot", "plotline"),
    item("quest", "quest", "plot"),
    item("nested", "quest", "quest"),
    item("leaf", "event"),
    item("other", "quest"),
  ];
  assert.deepEqual(
    availableParents(items, "quest").map((entry: PlanningItem) => entry.id),
    ["other", "plot"],
  );
});

void test("item edits retain tree and local-flow meaning without removing authored records", () => {
  const quest = item("quest", "quest"),
    child = item("child", "branch", "quest"),
    destination = item("destination", "plotline");
  const dataset = {
    items: [quest, child, destination],
    flows: [],
    references: [],
    consequences: [],
    notes: [],
    views: [],
  };
  assert.deepEqual(
    validateItemEdit(dataset, { ...quest, kind: "plotline", parentId: "destination" }),
    [],
  );
  assert.match(
    validateItemEdit(dataset, { ...quest, kind: "event", eventType: "story" })[0],
    /children first/,
  );
  assert.match(validateItemEdit(dataset, { ...quest, parentId: "child" }).join(" "), /leaf|cycle/);
  assert.match(validateItemEdit(dataset, { ...quest, parentId: "missing" })[0], /missing parent/);
  const connected = {
    ...dataset,
    items: [...dataset.items, item("sibling", "event", "quest")],
    flows: [flow({ id: "option", sourceId: "child", targetId: "sibling", kind: "option" })],
  };
  assert.match(validateItemEdit(connected, { ...child, parentId: null })[0], /story flows/);
  assert.match(validateItemEdit(connected, { ...child, kind: "event" })[0], /Option flows/);
  assert.deepEqual(validateItemEdit(connected, { ...quest, parentId: "destination" }), []);
  assert.match(validateItemEdit(dataset, item("missing", "quest"))[0], /no longer exists/);
});

void test("projection shows only direct children and real local flow", () => {
  const items = [
    item("quest-a", "quest"),
    item("quest-b", "quest"),
    item("event-a", "event", "quest-a"),
  ];
  const flows = [flow({ id: "root-flow", sourceId: "quest-a", targetId: "quest-b" })];
  const dataset = { items, flows, references: [], consequences: [], notes: [], views: [] };
  assert.deepEqual(
    directChildren(items, null).map((entry: PlanningItem) => entry.id),
    ["quest-a", "quest-b"],
  );
  assert.deepEqual(
    localFlows(dataset, null).map((entry: { id: string }) => entry.id),
    ["root-flow"],
  );
  assert.deepEqual(
    directChildren(items, "quest-a").map((entry: PlanningItem) => entry.id),
    ["event-a"],
  );
});

void test("dataset validation rejects cross-scope flow and ownership cycles", () => {
  const items = [
    item("quest-a", "quest"),
    item("quest-b", "quest"),
    item("event-a", "event", "quest-a"),
    item("event-b", "event", "quest-b"),
  ];
  const dataset = {
    items,
    flows: [flow({ id: "bad", sourceId: "event-a", targetId: "event-b" })],
    references: [],
    consequences: [],
    notes: [],
    views: [],
  };
  assert.match(validatePlanning(dataset).join(" "), /crosses canvas scopes/);
  assert.deepEqual(
    [...subtreeIds(items, "quest-a")].sort((left, right) => left.localeCompare(right)),
    ["event-a", "quest-a"],
  );
});

void test("new records use schema v3 and stable safe IDs", () => {
  const created = newItem("branch", null, 42);
  assert.equal(created.schemaVersion, 3);
  assert.equal(created.branchType, "decision");
  assert.match(created.id, /^branch-[a-f0-9-]+$/);
});

void test("annotation validation matches the Go ownership and anchor boundary", () => {
  const dataset = {
    items: [
      item("quest-a", "quest"),
      item("quest-b", "quest"),
      item("event-a", "event", "quest-a"),
    ],
    flows: [flow({ id: "flow-a", sourceId: "quest-a", targetId: "quest-b" })],
    references: [
      reference({
        id: "ref-a",
        itemId: "quest-b",
        target: { scope: "planning", itemId: "event-a" },
      }),
    ],
    consequences: [
      consequence({ id: "consequence-a", anchor: { scope: "flow", flowId: "flow-a" } }),
    ],
    notes: [note({ id: "note-a", anchorIds: ["quest-a", "event-a"] })],
    views: [],
  };
  assert.deepEqual(validatePlanning(dataset), []);
  assert.match(validatePlanning({ ...dataset, flows: [] }).join(" "), /missing flow anchor/);
  const withoutEvent = {
    ...dataset,
    items: dataset.items.filter((entry) => entry.id !== "event-a"),
  };
  assert.match(validatePlanning(withoutEvent).join(" "), /missing planning target/);
  assert.match(validatePlanning(withoutEvent).join(" "), /missing anchor event-a/);
  assert.match(
    validatePlanning({
      ...dataset,
      references: [{ ...dataset.references[0], itemId: "missing" }],
    }).join(" "),
    /missing item/,
  );
  assert.match(
    validatePlanning({
      ...dataset,
      consequences: [consequence({ id: "bad", anchor: { scope: "item", itemId: "missing" } })],
    }).join(" "),
    /missing item anchor/,
  );
});

void test("consequence planning targets must exist while optional and foreign targets remain annotations", () => {
  const dataset = {
    items: [item("owner", "quest"), item("destination", "quest")],
    flows: [],
    references: [],
    consequences: [],
    notes: [],
    views: [],
  };
  const effect = consequence({
    id: "effect",
    anchor: { scope: "item", itemId: "owner" },
    title: "Retain this",
    body: "Authored prose",
  });
  for (const target of [
    undefined,
    { scope: "planning", itemId: "destination" },
    { scope: "core", collection: "characters", id: "unavailable" },
    { scope: "external", addonId: "rules", kind: "spell", id: "unavailable", label: "Spell" },
  ]) {
    assert.deepEqual(
      validatePlanning({
        ...dataset,
        consequences: [{ ...effect, ...(target ? { target } : {}) }],
      }),
      [],
    );
  }
  const invalid = {
    ...dataset,
    consequences: [{ ...effect, target: { scope: "planning", itemId: "missing" } }],
  };
  const before = structuredClone(invalid);
  assert.deepEqual(validatePlanning(invalid), [
    "Consequence effect has a missing planning target.",
  ]);
  assert.deepEqual(invalid, before);
});

void test("a change is checked only for problems it adds, so a stored one never blocks other edits", () => {
  const quest = item("quest", "quest");
  const dataset = {
    items: [quest, item("other", "quest")],
    flows: [],
    references: [],
    consequences: [
      consequence({
        id: "effect",
        anchor: { scope: "item", itemId: "quest" },
        target: { scope: "planning", itemId: "gone" },
      }),
    ],
    notes: [],
    views: [],
  };
  const [stored, ...rest] = planningIssues(dataset);
  assert.deepEqual(rest, []);
  assert.deepEqual(
    [stored?.key, stored?.collection, stored?.id, stored?.code],
    [
      "planning_consequences:effect:missing-target",
      "planning_consequences",
      "effect",
      "missing-target",
    ],
  );
  assert.deepEqual(validateItemEdit(dataset, { ...quest, title: "Renamed" }), []);
  assert.deepEqual(validateChange(dataset, { ...dataset, consequences: [] }), []);
  assert.deepEqual(
    validateChange(dataset, {
      ...dataset,
      items: [...dataset.items, item("lost", "event", "gone")],
    }),
    ["lost has a missing parent."],
  );
  // A problem is named by record and rule, not wording: renaming keeps it.
  const orphan = { ...dataset, items: [...dataset.items, item("lost", "event", "gone")] };
  assert.deepEqual(
    validateChange(orphan, {
      ...orphan,
      items: orphan.items.map((entry) =>
        entry.id === "lost" ? { ...entry, title: "Found" } : entry,
      ),
    }),
    [],
  );
});

void test("each flow on a cycle is reported, so an unrelated flow is not a new problem", () => {
  const cycle = [
    flow({ id: "forward", sourceId: "a", targetId: "b" }),
    flow({ id: "back", sourceId: "b", targetId: "a" }),
  ];
  const dataset = {
    items: [item("a", "quest"), item("b", "quest"), item("c", "quest")],
    flows: cycle,
    references: [],
    consequences: [],
    notes: [],
    views: [],
  };
  assert.deepEqual(
    planningIssues(dataset).map((issue) => issue.key),
    ["planning_flow_links:forward:flow-cycle", "planning_flow_links:back:flow-cycle"],
  );
  const entry = flow({ id: "entry", sourceId: "c", targetId: "b" });
  assert.deepEqual(validateChange(dataset, { ...dataset, flows: [entry, ...cycle] }), []);
  const closing = flow({ id: "closing", sourceId: "a", targetId: "c" });
  assert.deepEqual(validateChange(dataset, { ...dataset, flows: [entry, closing, ...cycle] }), [
    "Flow entry is part of a cycle.",
    "Flow closing is part of a cycle.",
  ]);
});

test("tags are unique ignoring case and keep the first spelling", () => {
  assert.deepEqual(parseTags(" NPC, villain ,npc,, Villain ,Žena"), ["NPC", "villain", "Žena"]);
});

test("item deletion counts only notes that lose every anchor", () => {
  const items = [
    { ...newItem("quest", null), id: "quest-a" },
    { ...newItem("event", "quest-a"), id: "event-a" },
    { ...newItem("quest", null), id: "quest-b" },
  ];
  const note = (id: string, anchorIds: string[]) =>
    ({ id, schemaVersion: 3, title: id, body: "", anchorIds, updatedAt: 1 }) as DmNote;
  const notes = [
    note("only-child", ["event-a"]),
    note("shared", ["event-a", "quest-b"]),
    note("unanchored", []),
  ];
  assert.equal(notesDeletedWith({ items, notes }, ["quest-a"]), 1);
  assert.equal(notesDeletedWith({ items, notes }, ["quest-a", "quest-b"]), 2);
});

test("canvas view IDs stay valid for the longest item IDs", () => {
  assert.equal(scopeViewId(null), "scope-root");
  assert.equal(scopeViewId("quest-a"), "scope-quest-a");
  const long = "q".repeat(120);
  const id = scopeViewId(long);
  assert.match(id, /^[a-z0-9][a-z0-9._-]{0,119}$/);
  assert.equal(id, scopeViewId(long));
  assert.notEqual(id, scopeViewId("q".repeat(119) + "r"));
});
