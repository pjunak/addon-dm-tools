import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planningExport, planningExportName } from "#web/planning-export";
import type { PlanningDataset } from "../src/planning-model.ts";

const example = (name: string) =>
  JSON.parse(readFileSync(new URL(`../docs/examples/${name}`, import.meta.url), "utf8")) as Record<
    string,
    unknown
  >;

void test("export matches the documented baseline the Go checker accepts", () => {
  const source = example("planning-siblings.json");
  const stored = (records: unknown) =>
    (records as Record<string, unknown>[])
      .map(({ operation: _operation, ...record }) => ({
        ...record,
        updatedAt: source["generatedAt"],
      }))
      .reverse();
  const dataset = {
    items: stored(source["items"]),
    flows: stored(source["flowLinks"]),
    references: [],
    consequences: [],
    notes: [],
    views: [{ id: "root", schemaVersion: 3, scopeId: null, positions: {}, updatedAt: 1 }],
  } as unknown as PlanningDataset;
  // Stored order is reversed above, so a match also proves parents come first.
  assert.deepEqual(planningExport(dataset, 1785024030000), example("planning-export.json"));
});

void test("export keeps every stored record, including ones that break planning rules", () => {
  const record = { schemaVersion: 3, summary: "", body: "", objective: "", setup: "" };
  const quest = { ...record, id: "quest", kind: "quest", parentId: null, title: "Quest" };
  const orphan = { ...record, id: "orphan", kind: "quest", parentId: "gone", title: "Orphan" };
  const dataset = {
    items: [orphan, quest].map((item) => ({ ...item, resolution: "", tags: [], updatedAt: 5 })),
    flows: [],
    references: [],
    consequences: [
      {
        id: "effect",
        schemaVersion: 3,
        anchor: { scope: "item", itemId: "quest" },
        kind: "world",
        title: "Kept",
        body: "Authored prose",
        target: { scope: "planning", itemId: "gone" },
        updatedAt: 7,
      },
    ],
    notes: [],
    views: [],
  } as unknown as PlanningDataset;
  const exported = planningExport(dataset, 9);
  assert.deepEqual(
    exported.items.map((item) => [item.id, item.parentId, item.expectedUpdatedAt]),
    [
      ["quest", null, 5],
      ["orphan", "gone", 5],
    ],
  );
  const { updatedAt: _updatedAt, ...consequence } = dataset.consequences[0]!;
  assert.deepEqual(exported.consequences, [
    { operation: "update", ...consequence, expectedUpdatedAt: 7 },
  ]);
});

void test("export file name carries the UTC date", () => {
  assert.equal(
    planningExportName(new Date(Date.UTC(2026, 9, 11, 23, 30))),
    "dm-tools-planning-2026-10-11.json",
  );
});
