import { definePlannerElement } from "#web/planner-element";
import { PlanningRepository, type PlanningRecord } from "#web/planning-repository";
import { registerRuntime } from "#web/runtime";
import type { PlanningFlow, PlanningItem } from "../../src/planning-model.js";
import type {
  AddonContext,
  AddonDocument,
  ContributionContext,
  ServiceHandle,
} from "../../src/sdk.js";
import type { RenderingCheck } from "./rendering-contract.js";

interface PlannerFixtureElement extends HTMLElement {
  codexContribution: ContributionContext;
}

declare global {
  interface HTMLElementTagNameMap {
    "dm-tools-planner-page": PlannerFixtureElement;
  }
}

function item(id: string, title: string, summary: string): PlanningItem {
  return {
    id,
    schemaVersion: 3,
    kind: "quest",
    parentId: null,
    title,
    summary,
    body: "",
    objective: "",
    setup: "",
    resolution: "",
    tags: [],
    updatedAt: 1,
  };
}

function documentFor(value: PlanningRecord): AddonDocument<PlanningRecord> {
  return { key: value.id, revision: 1, value };
}

function requiredElement<T extends Element>(
  parent: ParentNode,
  selector: string,
  constructor: { new (): T },
): T {
  const element = parent.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing fixture element: ${selector}`);
  return element;
}

function closeTo(actual: number, expected: number, tolerance = 0.02): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

const items = [
  item("quest-a", "The silver road", "Cross the valley before the sleeping dragon wakes."),
  item("quest-b", "The sleeping dragon", "Reach the old gate without raising an alarm."),
];
const flow: PlanningFlow = {
  id: "root-flow",
  schemaVersion: 3,
  sourceId: "quest-a",
  targetId: "quest-b",
  kind: "continues",
  label: "Follow the silver thread",
  updatedAt: 1,
};
const documentsByCollection: Readonly<Record<string, readonly AddonDocument<PlanningRecord>[]>> = {
  planning_items: items.map(documentFor),
  planning_flow_links: [documentFor(flow)],
  planning_references: [],
  planning_consequences: [],
  dm_notes: [],
  planning_views: [],
};
const signal = new AbortController().signal;
const repository = new PlanningRepository({
  signal,
  data: {
    collection(id) {
      const documents = documentsByCollection[id] ?? [];
      return {
        async query() {
          return { documents, dataRevision: 1 };
        },
      };
    },
    async transact() {
      throw new Error("The rendering fixture does not allow mutations");
    },
  },
});
const adapters: ServiceHandle = {
  available: false,
  providers: [],
  async call<T>(): Promise<T> {
    throw new Error("No adapters in rendering fixture");
  },
};
const ui: AddonContext["ui"] = {
  enhance() {
    return { refresh() {}, dispose() {} };
  },
  bind() {
    return { dispose() {} };
  },
};
const generation = "a".repeat(64);
registerRuntime(generation, { ui, repository, adapters, signal });
definePlannerElement();

const planner = document.createElement("dm-tools-planner-page");
const contribution: ContributionContext = {
  addon: { id: "dm-tools", generation },
  contribution: { id: "planner.route", config: {} },
  signal,
  edits: { set() {} },
};
planner.codexContribution = contribution;
requiredElement(document, "#fixture", HTMLElement).append(planner);

for (
  let attempt = 0;
  attempt < 60 && planner.querySelectorAll(".dm-plan-card").length !== 2;
  attempt += 1
) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

globalThis.runRenderingContract = async ({ deviceScaleFactor }) => {
  const checks: RenderingCheck[] = [];
  const check = (name: string, pass: boolean, actual: unknown, expected: unknown): void => {
    checks.push({ name, pass, actual, expected });
  };
  const workspace = requiredElement(planner, ".dm-planner-workspace", HTMLElement);
  const stage = requiredElement(planner, ".dm-planner-stage", HTMLElement);
  const cards = [...planner.querySelectorAll<HTMLElement>(".dm-plan-card")];
  const [firstCard, secondCard] = cards;
  if (!firstCard || !secondCard || cards.length !== 2)
    throw new Error(`Expected two planner cards, found ${cards.length}`);
  const titles = cards.map((card) => requiredElement(card, "h3", HTMLHeadingElement).textContent);
  const summaries = cards.map(
    (card) => requiredElement(card, "p", HTMLParagraphElement).textContent,
  );
  const path = requiredElement(planner, ".dm-planner-flows path", SVGPathElement);

  check(
    "planner separates atlas and canvas from the edit dialog",
    workspace.children.length === 2,
    workspace.children.length,
    2,
  );
  check(
    "planner gives the canvas the remaining desktop width",
    getComputedStyle(workspace).gridTemplateColumns.split(" ").length === 2,
    getComputedStyle(workspace).gridTemplateColumns,
    "two resolved columns",
  );
  check(
    "planner renders both current records",
    JSON.stringify(titles) === JSON.stringify(["The silver road", "The sleeping dragon"]),
    titles,
    ["The silver road", "The sleeping dragon"],
  );
  check(
    "planner preserves record summaries",
    JSON.stringify(summaries) ===
      JSON.stringify([
        "Cross the valley before the sleeping dragon wakes.",
        "Reach the old gate without raising an alarm.",
      ]),
    summaries,
    "both source summaries",
  );
  check(
    "planner keeps deterministic default positions",
    firstCard.style.left === "72px" &&
      firstCard.style.top === "72px" &&
      secondCard.style.left === "372px" &&
      secondCard.style.top === "72px",
    cards.map((card) => ({ left: card.style.left, top: card.style.top })),
    [
      { left: "72px", top: "72px" },
      { left: "372px", top: "72px" },
    ],
  );
  check(
    "flow follows the card geometry",
    path.getAttribute("d") === "M 312 138 H 342 V 138 H 372",
    path.getAttribute("d"),
    "M 312 138 H 342 V 138 H 372",
  );
  check(
    "flow retains its accessible label",
    path.getAttribute("aria-label") === "Follow the silver thread",
    path.getAttribute("aria-label"),
    "Follow the silver thread",
  );
  const flowLabel = requiredElement(planner, ".dm-planner-flow-label", SVGTextElement);
  check(
    "flow label is visible native SVG text",
    flowLabel.textContent === "Follow the silver thread" &&
      getComputedStyle(flowLabel).transform === "none",
    flowLabel.textContent,
    "Follow the silver thread",
  );
  check(
    "flow direction has an arrowhead",
    path.getAttribute("marker-end") ===
      `url(#${requiredElement(planner, "marker", SVGMarkerElement).id})`,
    path.getAttribute("marker-end"),
    "the planner's arrow marker",
  );
  check(
    "planner does not raster-scale the canvas",
    getComputedStyle(stage).transform === "none" &&
      cards.every((card) => getComputedStyle(card).transform === "none"),
    {
      stage: getComputedStyle(stage).transform,
      cards: cards.map((card) => getComputedStyle(card).transform),
    },
    "no transforms",
  );

  for (const [index, card] of cards.entries()) {
    const bounds = card.getBoundingClientRect();
    check(`card ${index + 1} keeps its 240px width`, closeTo(bounds.width, 240), bounds.width, 240);
    check(
      `card ${index + 1} keeps its minimum height`,
      bounds.height >= 132,
      bounds.height,
      ">= 132",
    );
    const measurements: readonly { property: string; value: number }[] = [
      { property: "left", value: card.offsetLeft },
      { property: "top", value: card.offsetTop },
      { property: "width", value: bounds.width },
    ];
    for (const { property, value } of measurements) {
      const physicalPixels = value * deviceScaleFactor;
      check(
        `card ${index + 1} ${property} is device-pixel aligned`,
        closeTo(physicalPixels, Math.round(physicalPixels), 0.001),
        physicalPixels,
        Math.round(physicalPixels),
      );
    }
    const title = requiredElement(card, "h3", HTMLHeadingElement);
    const titleSize = Number.parseFloat(getComputedStyle(title).fontSize) * deviceScaleFactor;
    check(
      `card ${index + 1} title uses whole device pixels`,
      closeTo(titleSize, Math.round(titleSize), 0.001),
      titleSize,
      Math.round(titleSize),
    );
  }

  firstCard.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  const titleInput = requiredElement(planner, 'dialog input[name="title"]', HTMLInputElement);
  titleInput.value = "Title {0} $&";
  titleInput.dispatchEvent(new Event("input", { bubbles: true }));
  planner.codexContribution = { ...contribution, host: { locale: "cs" } };
  check(
    "locale refresh retains the mounted planner",
    document.querySelector("dm-tools-planner-page") === planner,
    planner.isConnected,
    true,
  );
  const localizedInput = requiredElement(planner, 'dialog input[name="title"]', HTMLInputElement);
  check(
    "locale refresh retains a named editor draft",
    localizedInput.value === "Title {0} $&",
    localizedInput.value,
    "Title {0} $&",
  );
  const localizedDialog = requiredElement(planner, "dialog", HTMLDialogElement);
  check(
    "locale refresh translates the open dialog",
    localizedDialog.getAttribute("aria-label") === "Upravit plánovací položku",
    localizedDialog.getAttribute("aria-label"),
    "Upravit plánovací položku",
  );
  const localizedForm = requiredElement(planner, "dialog form", HTMLFormElement);
  check(
    "locale refresh translates the form label",
    localizedForm.getAttribute("aria-label") === "Podrobnosti plánovací položky",
    localizedForm.getAttribute("aria-label"),
    "Podrobnosti plánovací položky",
  );
  const localizedCardTitle = requiredElement(planner, ".dm-plan-card h3", HTMLHeadingElement);
  check(
    "locale refresh keeps authored cards unchanged",
    localizedCardTitle.textContent === "The silver road",
    localizedCardTitle.textContent,
    "The silver road",
  );
  planner.codexContribution = contribution;
  const restoredDialog = requiredElement(planner, "dialog", HTMLDialogElement);
  check(
    "English can be restored without losing edits",
    requiredElement(planner, 'dialog input[name="title"]', HTMLInputElement).value ===
      "Title {0} $&" && restoredDialog.getAttribute("aria-label") === "Edit planning item",
    restoredDialog.getAttribute("aria-label"),
    "Edit planning item",
  );
  return { name: "DM Tools planner v3 rendering", checks };
};
