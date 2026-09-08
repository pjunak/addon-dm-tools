import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveRefresh } from '../web/live-refresh.js';
import { PlanningRepository } from '../web/planning-repository.js';

test('live refresh coalesces bursts, waits for drafts and interaction, and stops on disposal', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ready = false, reads = 0;
  const queue = new LiveRefresh(() => ready, () => { reads++; queue.consume(); });
  queue.invalidate(); queue.invalidate(); t.mock.timers.tick(150); assert.equal(reads, 0); assert.equal(queue.pending, true);
  ready = true; queue.wake(); queue.wake(); t.mock.timers.tick(150); assert.equal(reads, 1);
  queue.invalidate(); queue.consume(); t.mock.timers.tick(150); assert.equal(reads, 1);
  queue.invalidate(); queue.dispose(); t.mock.timers.tick(150); queue.invalidate(); queue.wake(); t.mock.timers.tick(150); assert.equal(reads, 1);
});

test('repository subscribes only to planning collections and reset with both lifetimes', () => {
  const generation = new AbortController(), view = new AbortController(); let listener, signal, calls = 0, disposed = 0;
  const repository = new PlanningRepository({ signal: generation.signal, data: { collection: () => ({}), subscribe: (fn, options) => { listener = fn; signal = options.signal; return () => disposed++; } } });
  const dispose = repository.subscribe(() => calls++, view.signal);
  for (const dataId of ['planning_items', 'planning_flow_links', 'planning_references', 'planning_consequences', 'dm_notes', 'planning_views']) listener({ reason: 'changed', kind: 'collection', dataId });
  listener({ reason: 'changed', kind: 'record-extension', dataId: 'planning_items' }); listener({ reason: 'changed', kind: 'collection', dataId: 'unrelated' }); listener({ reason: 'reset' });
  assert.equal(calls, 7); view.abort(); assert.equal(signal.aborted, true); dispose(); assert.equal(disposed, 1);
  const other = new AbortController(); repository.subscribe(() => {}, other.signal); generation.abort(); assert.equal(signal.aborted, true);
  assert.doesNotThrow(() => new PlanningRepository({ signal: other.signal, data: { collection: () => ({}) } }).subscribe(() => {}, other.signal)());
});
