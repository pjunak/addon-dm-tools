import test from 'node:test';
import assert from 'node:assert/strict';
import { en, cs } from '../web/import-catalogs.js';
import { importText, parseAdapterDescription, parseImportPreview, parseImportSource, selectAdapter } from '../web/import-model.js';

const description = { contractVersion: 'import-adapter-description.v1', id: 'stories', label: 'Stories', description: '', formats: ['story-json'] };
const preview = { contractVersion: 'import-preview-result.v1', token: 'a'.repeat(24), format: 'story-json', mode: 'merge', summary: { creates: 1, updates: 0, deletes: 0, skips: 3 }, warnings: [], changes: [{ operation: 'create', collection: 'stories', id: 'trail', label: 'Trail' }] };
test('routing uses only the advertised format and never the provider ID or document filename', () => {
  const parsed = parseImportSource('{"format":"story-json","data":{"arbitrary":true}}');
  assert.equal(parsed.document.data.arbitrary, true);
  const first = { provider: { addonId: 'unrelated-name' }, description: parseAdapterDescription(description) };
  const other = { provider: { addonId: 'dm-tools' }, description: { ...description, formats: ['different-format'] } };
  assert.equal(selectAdapter([other, first], parsed.format), first);
  assert.throws(() => selectAdapter([first, first], parsed.format), error => error.key === 'center.formatAmbiguous');
  assert.throws(() => selectAdapter([other], parsed.format), error => error.key === 'center.formatUnsupported');
  for (const value of ['invalid', '[]', '{}', '{"format":4}']) assert.throws(() => parseImportSource(value));
});
test('broken descriptions and inconsistent reviews cannot offer a commit', () => {
  for (const patch of [{ label: '' }, { formats: [] }, { formats: ['story-json', 'story-json'] }, { formats: ['bad/format'] }]) assert.throws(() => parseAdapterDescription({ ...description, ...patch }));
  assert.deepEqual(parseImportPreview(preview, 'story-json'), preview);
  for (const patch of [{ format: 'other-json' }, { token: 'short' }, { summary: { ...preview.summary, deletes: 1 } }, { summary: { ...preview.summary, skips: -1 } }, { changes: [] }, { warnings: [5] }, { changes: [{ ...preview.changes[0], operation: 'execute' }] }]) assert.throws(() => parseImportPreview({ ...preview, ...patch }, 'story-json'));
});
test('English and Czech catalogs retain placeholders and literal imported labels', () => {
  assert.deepEqual(Object.keys(en), Object.keys(cs));
  for (const key of Object.keys(en)) {
    assert.ok(cs[key].trim()); assert.deepEqual(en[key].match(/\{[^}]+\}/g) ?? [], cs[key].match(/\{[^}]+\}/g) ?? [], key);
  }
  assert.equal(importText('cs', 'center.title'), 'Centrum importu');
  assert.equal(importText('en', 'previewTitle', { label: '<b>{format}</b>' }), '<b>{format}</b> preview');
});
