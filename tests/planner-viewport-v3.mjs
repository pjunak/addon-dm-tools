import test from "node:test";
import assert from "node:assert/strict";
import { stepZoom, fittedZoom, canvasBounds, nativePixel, positionsFor } from "../web/planner-viewport.js";

test("canvas zoom follows the preserved ladder and stops at native size", () => {
  assert.equal(stepZoom(.9, 1), 1); assert.equal(stepZoom(1.1, -1), 1);
  assert.equal(stepZoom(.35, -1), .35); assert.equal(stepZoom(2, 1), 2);
  assert.equal(fittedZoom(1000, 600, 748, 500), .7);
  assert.equal(fittedZoom(100, 100, 1000, 1000), 1);
});
test("canvas bounds retain negative and distant positions without changing saved coordinates", () => {
  const points = [{ x: -240, y: -120 }, { x: 2100, y: 900 }];
  assert.deepEqual(canvasBounds(points), { left: -264, top: -144, width: 2628, height: 1200 });
  assert.deepEqual(points[0], { x: -240, y: -120 });
  assert.equal(nativePixel(12.3, 2), 12.5);
});

test('automatic positions avoid authored cards without changing the saved layout', () => {
  const items = ['new-a', 'saved', 'new-b', 'new-c'].map(id => ({ id }));
  const views = [{ scopeId: null, positions: { saved: { x: 120, y: 96 } } }, { scopeId: 'elsewhere', positions: { 'new-a': { x: -200, y: 300 } } }];
  const before = structuredClone(views), result = positionsFor(views, null, items);
  assert.deepEqual(result.get('saved'), { x: 120, y: 96 }); assert.deepEqual(views, before);
  const points = [...result.values()];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) assert.ok(Math.abs(points[i].x - points[j].x) >= 264 || Math.abs(points[i].y - points[j].y) >= 156);
  assert.deepEqual([...positionsFor([], null, items).values()], [{ x: 72, y: 72 }, { x: 372, y: 72 }, { x: 672, y: 72 }, { x: 72, y: 262 }]);
});
