import { definePlannerElement } from "#web/planner-element";
import { PlanningRepository, type PlanningRecord } from "#web/planning-repository";
import { registerRuntime } from "#web/runtime";
import type { PlanningItem } from "../../src/planning-model.js";
import type {
  AddonContext,
  AddonDocument,
  ContributionContext,
  DataMutation,
  DataSetRevision,
  ServiceHandle,
} from "../../src/sdk.js";
import type { RenderingCheck } from "./rendering-contract.js";

// Saved planning with links to an item that no longer exists: the planner must
// still open, list each problem with its repair, and repair one with a guarded
// write.
interface PlannerFixtureElement extends HTMLElement {
  codexContribution: ContributionContext;
}

const quest: PlanningItem = {
  id: "quest-a",
  schemaVersion: 3,
  kind: "quest",
  parentId: null,
  title: "The silver road",
  summary: "Cross the valley before the sleeping dragon wakes.",
  body: "",
  objective: "",
  setup: "",
  resolution: "",
  tags: [],
  updatedAt: 1,
};
const stored: Readonly<Record<string, readonly PlanningRecord[]>> = {
  planning_items: [quest],
  planning_flow_links: [],
  planning_references: [
    {
      id: "ref",
      schemaVersion: 3,
      itemId: "gone",
      name: "Black lotus",
      relation: "related",
      target: { scope: "core", collection: "artifacts", id: "lotus" },
      quantity: 1,
      notes: "",
      updatedAt: 1,
    },
  ],
  planning_consequences: [
    {
      id: "effect",
      schemaVersion: 3,
      anchor: { scope: "item", itemId: "quest-a" },
      kind: "world",
      title: "The bridge falls",
      body: "Keep this prose.",
      target: { scope: "planning", itemId: "gone" },
      updatedAt: 1,
    },
  ],
  dm_notes: [
    {
      id: "note",
      schemaVersion: 3,
      title: "Ferry schedule",
      body: "",
      anchorIds: ["quest-a", "gone"],
      updatedAt: 1,
    },
  ],
  planning_views: [],
};
const store = new Map(
  Object.entries(stored).map(([id, records]) => [
    id,
    {
      revision: 1,
      documents: new Map(
        records.map((value): [string, AddonDocument<PlanningRecord>] => [
          value.id,
          { key: value.id, revision: 1, value },
        ]),
      ),
    },
  ]),
);
const transactions: { mutations: readonly DataMutation[]; guards: readonly DataSetRevision[] }[] =
  [];

function collection(id: string) {
  const value = store.get(id);
  if (!value) throw new Error(`Unknown collection ${id}`);
  return value;
}

const signal = new AbortController().signal;
const repository = new PlanningRepository({
  signal,
  data: {
    collection(id) {
      return {
        async query() {
          const { documents, revision } = collection(id);
          return { documents: [...documents.values()], dataRevision: revision };
        },
      };
    },
    async transact(mutations, options) {
      const guards = options?.expectedDataSets ?? [];
      transactions.push({ mutations, guards });
      if (guards.some((guard) => collection(guard.dataId).revision !== guard.revision))
        throw new Error("Collection changed");
      return {
        results: mutations.map((mutation) => {
          const target = collection(mutation.dataId),
            afterRevision = mutation.expectedRevision + 1;
          if ((target.documents.get(mutation.key)?.revision ?? 0) !== mutation.expectedRevision)
            throw new Error("Record changed");
          if (mutation.operation === "put")
            target.documents.set(mutation.key, {
              key: mutation.key,
              revision: afterRevision,
              value: mutation.value as PlanningRecord,
            });
          else target.documents.delete(mutation.key);
          target.revision += 1;
          return {
            kind: mutation.kind,
            dataId: mutation.dataId,
            key: mutation.key,
            beforeRevision: mutation.expectedRevision,
            afterRevision,
            deleted: mutation.operation === "delete",
          };
        }),
      };
    },
  },
});
const adapters: ServiceHandle = {
  contract: "codex.import-adapter",
  range: ">=2.0.0 <4.0.0",
  cardinality: "many",
  available: false,
  providers: [],
  async call<T>(): Promise<T> {
    throw new Error("No adapters in rendering fixture");
  },
};
const declaration = {
  id: "planner.route",
  surface: "route",
  label: "Planner",
  roles: ["dm"],
  order: 0,
  requires: [],
  config: {},
} as const;
const ui: AddonContext["ui"] = {
  enhance() {
    return { refresh() {}, dispose() {} };
  },
  async showRuleDetails() {},
  declarations: () => [],
  bind(_id, binding) {
    void binding;
    return { descriptor: declaration, dispose() {} };
  },
};
const generation = "b".repeat(64);
registerRuntime(generation, { ui, repository, adapters, signal });
const tag = definePlannerElement(generation);

const planner = document.createElement(tag) as PlannerFixtureElement;
planner.codexContribution = {
  addon: { id: "dm-tools", generation },
  contribution: declaration,
  signal,
  edits: { set() {} },
  host: { contractVersion: "addon-route-context.v1", locale: "en", query: [] },
};
document.querySelector("#fixture")?.append(planner);

async function frames(until: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 120 && !until(); attempt += 1)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
const rows = () => [...planner.querySelectorAll<HTMLElement>(".dm-planner-issues li")];
const texts = (selector: string) =>
  rows().map((row) => row.querySelector(selector)?.textContent ?? "");
const buttons = () =>
  rows().map((row) => [...row.querySelectorAll("button")].map((button) => button.textContent));
await frames(() => rows().length > 0);

globalThis.runRenderingContract = async () => {
  const checks: RenderingCheck[] = [];
  const check = (name: string, actual: unknown, expected: unknown): void => {
    checks.push({
      name,
      pass: JSON.stringify(actual) === JSON.stringify(expected),
      actual,
      expected,
    });
  };
  check("planner opens with stored problems", planner.querySelectorAll(".dm-plan-card").length, 1);
  check("the list names each problem", texts("p"), [
    "Reference ref has a missing item.",
    "Consequence effect has a missing planning target.",
    "Note note has a missing anchor gone.",
  ]);
  check("each problem names its record", texts(".dm-planner-issue-record"), [
    "Black lotus",
    "The bridge falls",
    "Ferry schedule",
  ]);
  check("each problem offers its repair", buttons(), [
    ["Delete reference"],
    ["Remove missing target", "Edit item"],
    ["Remove missing links", "Edit item"],
  ]);
  const panel = planner.querySelector<HTMLElement>(".dm-planner-issues");
  check("the list fits the planner width", panel && panel.scrollWidth <= panel.clientWidth, true);

  rows()[1]?.querySelector("button")?.click();
  await frames(() => rows().length === 2);
  const [write] = transactions;
  const value = write?.mutations[0]?.operation === "put" ? write.mutations[0].value : undefined;
  check("a repair is one guarded write", [transactions.length, write?.guards.length], [1, 6]);
  check(
    "removing a missing target keeps the consequence text",
    value && typeof value === "object"
      ? [Object.hasOwn(value, "target"), "body" in value && value.body]
      : [],
    [false, "Keep this prose."],
  );
  check("the repaired problem leaves the list", texts("p"), [
    "Reference ref has a missing item.",
    "Note note has a missing anchor gone.",
  ]);

  rows()[1]?.querySelectorAll("button")[1]?.click();
  const dialog = planner.querySelector("dialog");
  check(
    "Edit item opens the owning item on the matching tab",
    [
      dialog?.getAttribute("aria-label"),
      dialog?.querySelector('[aria-selected="true"]')?.textContent,
    ],
    ["Edit planning item", "Notes"],
  );
  return { name: "DM Tools planner problems", checks };
};
