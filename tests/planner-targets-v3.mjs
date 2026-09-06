import test from "node:test";
import assert from "node:assert/strict";
import { coreReferences, targetFromForm } from "../web/planner-targets.js";
import { noteAnchors } from "../web/planner-note-anchors.js";

const items = [{ id: "quest", title: "Quest" }];
const record = { collection: "events", id: "arrival", label: "Arrival", href: "#/events/arrival" };
const core = { records: [record], ready: true, truncated: false };
const form = values => { const data = new FormData(); for (const [name, value] of Object.entries(values)) data.set(name, value); return data; };

test("target choices reject malformed host catalogs and unsafe record links", () => {
  assert.deepEqual(coreReferences({ recordReferences: core }), core);
  assert.deepEqual(coreReferences({ recordReferences: { ...core, records: [{ ...record, href: "javascript:alert(1)" }, { ...record, collection: "settings" }] } }).records, []);
  assert.equal(coreReferences({}).ready, false);
});

test("reference editing selects existing targets and preserves unavailable saved targets", () => {
  assert.deepEqual(targetFromForm(form({ targetScope: "planning", targetPlanningId: "quest" }), items, core), { scope: "planning", itemId: "quest" });
  assert.deepEqual(targetFromForm(form({ targetScope: "core", targetCoreId: '["events","arrival"]' }), items, core), { scope: "core", collection: "events", id: "arrival" });
  const current = { scope: "core", collection: "characters", id: "missing" };
  const data = form({ targetScope: "core", targetCoreId: '["characters","missing"]' });
  assert.deepEqual(targetFromForm(data, items, core, current), current);
  assert.throws(() => targetFromForm(data, items, core), /available campaign record/);
  assert.throws(() => targetFromForm(form({ targetScope: "planning", targetPlanningId: "missing" }), items, core), /existing planning item/);
  assert.equal(targetFromForm(form({ targetScope: "none" }), items, core, current, true), undefined);
  assert.throws(() => targetFromForm(form({ targetScope: "none" }), items, core), /target type/);
});

test("external targets require explicit valid identifiers and a display label", () => {
  const values = { targetScope: "external", targetAddonId: "rules-addon", targetKind: "monster", targetRecordId: "wolf", targetLabel: "Wolf" };
  assert.deepEqual(targetFromForm(form(values), items, core), { scope: "external", addonId: "rules-addon", kind: "monster", id: "wolf", label: "Wolf" });
  for (const change of [{ targetAddonId: "bad/id" }, { targetRecordId: "constructor" }, { targetLabel: " " }]) assert.throws(() => targetFromForm(form({ ...values, ...change }), items, core), /external target/);
});

test("shared note anchors allow unlinking but reject missing or duplicate items", () => {
  assert.deepEqual(noteAnchors('["quest"]', items), ["quest"]);
  assert.deepEqual(noteAnchors('[]', items), []);
  for (const value of ['["missing"]', '["quest","quest"]', 'null', 'invalid']) assert.throws(() => noteAnchors(value, items), /planning items/);
});
