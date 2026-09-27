import test from "node:test";
import assert from "node:assert/strict";
import {
  PlannerRecoveryStore,
  parseRecovery,
  provisionalItem,
  recoveryLimit,
} from "#web/planner-recovery";
import { PlannerDrafts } from "#web/planner-drafts";
import type {
  PlannerRecovery,
  PlannerRecoveryStore as RecoveryStore,
} from "../src/planner-recovery.ts";
import type { PlanningKind } from "../src/planning-model.ts";

type DraftValues = Record<string, string>;
type DraftEntry = [string, { revision: number; baseline: DraftValues; values: DraftValues }];
type ProvisionalFixture = {
  id: string;
  kind: PlanningKind;
  parentId: string | null;
  title: string;
  updatedAt: number;
};
type RecoveryFixture = {
  format: PlannerRecovery["format"];
  drafts: DraftEntry[];
  provisional: ProvisionalFixture | null;
  unconfirmed: string[];
  editor: string | null;
  tab: PlannerRecovery["tab"];
};

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}
function recovery(): RecoveryFixture {
  return {
    format: "dm-tools-planner-drafts.v1",
    drafts: [
      [
        "planning_items:quest-a",
        {
          revision: 7,
          baseline: { title: "Saved", body: "Original" },
          values: { title: "Draft", body: "Unsent text" },
        },
      ],
    ],
    provisional: null,
    unconfirmed: [],
    editor: "quest-a",
    tab: "details",
  };
}
function readReady(store: RecoveryStore): PlannerRecovery {
  const result = store.read();
  if (result.kind !== "ready") assert.fail(`expected ready recovery, got ${result.kind}`);
  return result.value;
}
void test("recovery preserves original revisions and separates site-tab stores and addon namespaces", () => {
  const tab = storage(),
    otherTab = storage(),
    store = new PlannerRecoveryStore(() => tab, "dm-tools");
  store.save(recovery());
  assert.deepEqual(store.read(), { kind: "ready", value: recovery() });
  assert.deepEqual(new PlannerRecoveryStore(() => tab, "other-addon").read(), { kind: "empty" });
  assert.deepEqual(new PlannerRecoveryStore(() => otherTab, "dm-tools").read(), { kind: "empty" });
  const firstRead = store.read();
  assert.equal(firstRead.kind, "ready");
  assert.ok(firstRead.value);
  const firstDraft = firstRead.value.drafts[0];
  assert.ok(firstDraft);
  firstDraft[1].values.body = "Changed returned value";
  const secondRead = store.read();
  assert.equal(secondRead.kind, "ready");
  assert.ok(secondRead.value);
  const secondDraft = secondRead.value.drafts[0];
  assert.ok(secondDraft);
  assert.equal(secondDraft[1].values.body, "Unsent text");
  store.clear();
  assert.deepEqual(store.read(), { kind: "empty" });
});
void test("all planner form types survive serialization and restore without sharing mutable values", () => {
  const original = recovery();
  original.drafts = [
    "planning_items",
    "planning_flow_links",
    "planning_references",
    "planning_consequences",
    "dm_notes",
    "new-flow",
    "new-reference",
  ].map((prefix): DraftEntry => [
    prefix + ":sample",
    {
      revision: prefix.startsWith("new-") ? 0 : 3,
      baseline: { body: "Saved" },
      values: { body: "<script>authored, inert text</script>" },
    },
  ]);
  const parsed = parseRecovery(JSON.stringify(original)),
    drafts = new PlannerDrafts();
  drafts.restore(parsed.drafts);
  parsed.drafts[0][1].values.body = "Changed";
  assert.equal([...drafts.entries()].length, 7);
  assert.equal([...drafts.entries()][0][1].values.body, "<script>authored, inert text</script>");
  drafts.clear("dm_notes:sample");
  drafts.rekey("new-flow:sample", "new-flow:moved");
  assert.equal(drafts.has("dm_notes:sample"), false);
  assert.equal(drafts.has("new-flow:moved"), true);
});
void test("provisional identity, original parent and interrupted-save status survive recovery", () => {
  const original = recovery();
  original.provisional = {
    id: "new-quest",
    kind: "quest",
    parentId: "missing-parent",
    title: "New quest",
    updatedAt: 12,
  };
  original.drafts.push([
    "new-item:new-quest",
    { revision: 0, baseline: { title: "New quest" }, values: { title: "Authored" } },
  ]);
  original.unconfirmed = ["new-item:new-quest"];
  const parsed = parseRecovery(JSON.stringify(original));
  assert.ok(parsed.provisional);
  const item = provisionalItem(parsed.provisional);
  assert.equal(item.id, "new-quest");
  assert.equal(item.parentId, "missing-parent");
  assert.equal(item.schemaVersion, 3);
  assert.deepEqual(parsed.unconfirmed, ["new-item:new-quest"]);
  assert.equal(parsed.drafts[1][1].revision, 0);
});
void test("malformed, unsupported and oversized copies remain available for explicit download or discard", () => {
  const tab = storage(),
    store = new PlannerRecoveryStore(() => tab, "dm-tools");
  store.save(recovery());
  const key = [...tab.values.keys()][0];
  for (const raw of [
    "{",
    JSON.stringify({ ...recovery(), format: "future" }),
    "x".repeat(recoveryLimit + 1),
  ]) {
    tab.setItem(key, raw);
    assert.deepEqual(store.read(), { kind: "invalid", raw });
    assert.equal(tab.getItem(key), raw);
  }
});
void test("invalid revisions, fields, identities and ambiguous draft entries fail closed", () => {
  const cases: Array<(value: RecoveryFixture) => void> = [
    (value) => {
      value.drafts[0][1].revision = -1;
    },
    (value) => {
      value.drafts[0][1].revision = 0.5;
    },
    (value) => {
      Object.assign(value.drafts[0][1].values, { body: {} });
    },
    (value) => {
      value.drafts[0][1].values.body = "x".repeat(160001);
    },
    (value) => {
      value.drafts[0][1].values = JSON.parse('{"__proto__":"invalid"}');
    },
    (value) => {
      value.drafts.push(value.drafts[0]);
    },
    (value) => {
      value.drafts[0][0] = "foreign:record";
    },
    (value) => {
      value.drafts[0][0] = "planning_items:";
    },
    (value) => {
      value.unconfirmed = ["planning_items:missing"];
    },
    (value) => {
      value.drafts[0][0] = "new-item:orphan";
    },
    (value) => {
      Object.assign(value, { tab: "unrecognized" });
    },
    (value) => {
      Object.assign(value, {
        provisional: { id: "new", kind: "script", parentId: null, title: "", updatedAt: 1 },
      });
    },
  ];
  for (const mutate of cases) {
    const value = recovery();
    mutate(value);
    assert.throws(() => parseRecovery(JSON.stringify(value)));
  }
});
void test("bounded recovery rejects excess forms and leaves the previous copy unchanged on write failure", () => {
  const tab = storage(),
    store = new PlannerRecoveryStore(() => tab, "dm-tools");
  store.save(recovery());
  const value = recovery();
  value.drafts = Array.from({ length: 51 }, (_, index) => [
    `planning_items:item-${index}`,
    value.drafts[0][1],
  ]);
  assert.throws(() => store.save(value));
  assert.deepEqual(readReady(store), recovery());
  const limited = new PlannerRecoveryStore(
    () => ({
      ...tab,
      setItem() {
        throw new Error("Quota exceeded");
      },
    }),
    "dm-tools",
  );
  assert.throws(() => limited.save({ ...recovery(), editor: null }));
  assert.deepEqual(readReady(store), recovery());
});
void test("blocked browser storage fails visibly without claiming a recovery copy", () => {
  const store = new PlannerRecoveryStore(() => {
    throw new Error("Storage blocked");
  }, "dm-tools");
  assert.deepEqual(store.read(), { kind: "unavailable" });
  assert.throws(() => store.save(recovery()));
  assert.throws(() => store.clear());
});
