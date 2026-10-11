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

void test("export file name carries the UTC date", () => {
  assert.equal(
    planningExportName(new Date(Date.UTC(2026, 9, 11, 23, 30))),
    "dm-tools-planning-2026-10-11.json",
  );
});
