import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlannerError, plannerCs, plannerEn, plannerError, plannerTranslator } from '../web/planner-catalogs.js';
import { newItem, validatePlanning, validateItemEdit } from '../web/planning-model.js';
import { targetLabel } from '../web/planner-targets.js';

test('planner catalogs preserve every placeholder and authored interpolation', () => {
  assert.deepEqual(Object.keys(plannerEn), Object.keys(plannerCs));
  const placeholders = value => [...value.matchAll(/\{\w+\}/gu)].map(match => match[0]).sort();
  for (const key of Object.keys(plannerEn)) {
    assert.ok(plannerCs[key].trim(), key);
    assert.deepEqual(placeholders(plannerEn[key]), placeholders(plannerCs[key]), key);
  }
  const t = plannerTranslator('cs');
  assert.equal(t('Connect from {0}', { 0: 'Title {0} $&' }), 'Propojit z: Title {0} $&');
  assert.equal(plannerTranslator('unknown')('Save item'), 'Save item');
});

test('localized planner validation keeps IDs, authored labels and dataset meaning', () => {
  const t = plannerTranslator('cs'), item = newItem('quest', null, 1, t);
  assert.equal(item.title, 'Nová položka: úkol'); assert.equal(item.kind, 'quest');
  const data = { items: [{ ...item, title: 'Title {0} $&', parentId: 'missing' }], flows: [], references: [], consequences: [], notes: [], views: [] };
  const original = structuredClone(data);
  assert.deepEqual(validatePlanning(data, t), ['Položce „Title {0} $&“ chybí nadřazená položka.']);
  assert.deepEqual(data, original);
  assert.equal(validateItemEdit(data, { ...item, id: 'missing' }, t)[0], 'Tato plánovací položka již neexistuje. Obnovte plánovač.');
  assert.equal(targetLabel({ scope: 'planning', itemId: item.id }, data.items, { records: [], ready: true, truncated: false }, t), 'Title {0} $&');
});

test('package-owned failures translate in the receiving view without rewriting foreign diagnostics', () => {
  const error = new PlannerError('Unavailable: {0}', { 0: 'Title {0} $&' });
  assert.equal(error.message, 'Unavailable: Title {0} $&');
  assert.equal(plannerError(error, plannerTranslator('cs'), 'fallback'), 'Nedostupné: Title {0} $&');
  assert.equal(plannerError(new Error('Unavailable: authored'), plannerTranslator('cs'), 'Obnovte plánovač.'), 'Obnovte plánovač.');
});
