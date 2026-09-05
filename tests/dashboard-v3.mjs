import test from "node:test";
import assert from "node:assert/strict";
import { dashboardLocale, dashboardText, plannerLink, plannerSelection, plannerTarget, planningImportStatus, summarizePlanning } from "../web/dashboard-model.js";

const route = query => ({ contractVersion: "addon-route-context.v1", locale: "en", query });
const item = (id, kind, updatedAt = 1, parentId = null) => ({ id, kind, title: id, updatedAt, parentId });

test("dashboard counts the full campaign and limits recent items without reordering stored data", () => {
  const items = [item("plotline", "plotline"), item("quest", "quest"),
    { ...item("encounter", "event", 4), eventType: "encounter" },
    ...Array.from({ length: 12 }, (_, i) => item(`story-${i}`, "event", 2))];
  const before = structuredClone(items);
  const summary = summarizePlanning({ items, notes: [{ id: "note" }] }, "en");
  assert.deepEqual(summary.counts, { total: 15, plotlines: 1, quests: 1, encounters: 1, notes: 1 });
  assert.equal(summary.recent.length, 12); assert.equal(summary.recent[0].id, "encounter");
  assert.deepEqual(summary.recent.slice(1).map(entry => entry.id), items.slice(3).map(entry => entry.id).sort().slice(0, 11));
  assert.deepEqual(items, before);
  assert.deepEqual(summarizePlanning({ items: [], notes: [] }, "cs").recent, []);
});

test("planner links open containers or select leaf records in their parent canvas", () => {
  const items = [item("plot", "plotline"), item("quest", "quest", 1, "plot"), item("scene", "event", 1, "quest"), item("branch", "branch")];
  assert.equal(plannerLink("dm-tools", "scene"), "#/addons/dm-tools/planner?item=scene");
  assert.equal(plannerTarget(route([["item", "scene"]])), "scene");
  assert.equal(plannerTarget(route([])), undefined); assert.equal(plannerTarget(undefined), undefined);
  assert.deepEqual(plannerSelection(items, "quest"), { scopeId: "quest", selectedId: undefined });
  assert.deepEqual(plannerSelection(items, "scene"), { scopeId: "quest", selectedId: "scene" });
  assert.deepEqual(plannerSelection(items, "branch"), { scopeId: null, selectedId: "branch" });
  assert.deepEqual(plannerSelection(items, undefined), { scopeId: null, selectedId: undefined });
  assert.throws(() => plannerSelection(items, "deleted"), /no longer exists/);
  for (const query of [null, {}, [["item", "a"], ["item", "b"]], [["scope", "a"]], [["item", "../quest"]], [["item", ""]], [["item", "constructor"]], [["item", "a".repeat(121)]], [["item", 1]]]) {
    assert.throws(() => plannerTarget(route(query)), /Invalid planner link/);
  }
});

test("dashboard uses the selected English or Czech catalog", () => {
  assert.equal(dashboardLocale({ locale: "cs" }), "cs"); assert.equal(dashboardLocale({ locale: "unknown" }), "en");
  assert.equal(dashboardText("cs", "dashboard.title"), "Plánování kampaně");
  assert.equal(dashboardText("en", "dashboard.title"), "Campaign Planning");
});

test("planning import availability follows advertised formats and contains optional provider failures", async () => {
  const check = async descriptions => planningImportStatus({
    providers: descriptions.map((_, index) => ({ addonId: `provider-${index}` })),
    call: async (method, input, options) => {
      assert.equal(method, "describe"); assert.deepEqual(input, {}); assert.equal(options.deadlineMs, 3000);
      const description = descriptions[Number(options.providerAddonId.split("-")[1])];
      if (description instanceof Error) throw description;
      return description;
    },
  }, new AbortController().signal);
  const describes = formats => ({ contractVersion: "import-adapter-description.v1", formats });
  assert.equal(await check([]), "missing");
  assert.equal(await check([describes(["campaign-bundle"])]), "missing");
  assert.equal(await check([new Error("offline"), { formats: [] }]), "error");
  assert.equal(await check([new Error("offline"), describes(["dm-tools-planning"])]), "ready");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(planningImportStatus({ providers: [] }, controller.signal), { name: "AbortError" });
});
