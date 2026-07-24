import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createImportCenter } from '../import-center.js';

const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));
const cs = JSON.parse(await readFile(new URL('../locales/cs.json', import.meta.url), 'utf8'));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function plan(diagnostics = [], operations = []) {
  return { diagnostics, operations };
}

function interpolate(value, params = {}) {
  return String(value).replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key) => String(params[key] ?? `{${key}}`));
}

function hostFixture({ locale = 'en', imports = {}, isDM = true } = {}) {
  const catalog = locale === 'cs' ? cs : en;
  const rec = { rerenders: 0, announces: [], focus: [], commits: 0, cancels: 0 };
  const host = {
    i18n: {
      t: (key, params) => interpolate(catalog[key] ?? en[key] ?? key, params),
      formatNumber: value => String(value),
    },
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[char])),
      dataAction: name => ` data-action="${name}"`,
      dataOn: (kind, name) => ` data-on-${kind}="${name}"`,
      breadcrumb: () => '',
    },
    action: name => `dm-tools:${name}`,
    role: { isDM: () => isDM },
    ui: {
      rerender: () => { rec.rerenders++; },
      announce: message => { rec.announces.push(message); },
    },
    imports: {
      listProviders: async () => ({ providers: [{ id: 'scenario-json' }] }),
      createJob: async () => ({ id: 'job-1', state: 'created' }),
      preview: async () => ({
        id: 'job-1',
        state: 'preview-ready',
        previewToken: 'token',
        committable: true,
        plan: plan([{ severity: 'info', code: 'SCENARIO_CREATE', path: ['scenarios', 0] }], [
          { id: 'first', value: { name: 'First', status: 'planned' } },
        ]),
      }),
      commit: async () => {
        rec.commits++;
        return { state: 'completed', operationCount: 1, commitId: 'commit-1' };
      },
      getJob: async () => ({ state: 'completed', result: { state: 'completed', operationCount: 1, commitId: 'commit-1' } }),
      cancel: async () => {
        rec.cancels++;
        return { state: 'cancelled' };
      },
      ...imports,
    },
  };
  const center = createImportCenter(host, { focus: id => rec.focus.push(id) });
  return { center, host, rec };
}

async function readyCenter(fixture, previewResult) {
  await fixture.center.initialize();
  fixture.center.selectFile({ files: [{ name: 'scenarios.json', size: 2 }] });
  if (previewResult) fixture.host.imports.preview = async () => previewResult;
  await fixture.center.requestPreview();
}

test('state machine keeps validation, preview, review, commit, and result distinct', async () => {
  const validation = deferred();
  const fixture = hostFixture({
    imports: { createJob: () => validation.promise },
  });
  await fixture.center.initialize();
  fixture.center.selectFile({ files: [{ name: 'scenarios.json', size: 2 }] });
  const previewing = fixture.center.requestPreview();
  assert.equal(fixture.center.getState().step, 'validating');
  validation.resolve({ id: 'job-1' });
  await previewing;
  assert.equal(fixture.center.getState().step, 'preview');
  fixture.center.review();
  assert.equal(fixture.center.getState().step, 'review');
  fixture.center.confirm(true);
  const committing = fixture.center.commit();
  assert.equal(fixture.center.getState().step, 'committing');
  await committing;
  assert.equal(fixture.center.getState().step, 'completed');
  assert.equal(fixture.rec.commits, 1);
  assert.ok(fixture.rec.announces.includes(en['announce.completed']));
});

test('commit requires confirmation, blocks invalid previews, and prevents double submit', async () => {
  const commitGate = deferred();
  const fixture = hostFixture({
    imports: {
      commit: async () => {
        fixture.rec.commits++;
        return commitGate.promise;
      },
    },
  });
  await readyCenter(fixture);
  fixture.center.review();
  await fixture.center.commit();
  assert.equal(fixture.rec.commits, 0);
  fixture.center.confirm(true);
  const first = fixture.center.commit();
  const second = fixture.center.commit();
  assert.equal(fixture.rec.commits, 1);
  commitGate.resolve({ state: 'completed', operationCount: 1, commitId: 'one' });
  await Promise.all([first, second]);

  const invalid = hostFixture();
  await readyCenter(invalid, {
    id: 'job-1',
    previewToken: 'token',
    committable: false,
    plan: plan([{ severity: 'error', code: 'SCENARIO_CONFLICT', path: ['scenarios', 0] }]),
  });
  invalid.center.review();
  invalid.center.confirm(true);
  await invalid.center.commit();
  assert.equal(invalid.rec.commits, 0);
  assert.equal(invalid.center.getState().counts.conflicts, 1);
});

test('revision conflict, cancellation, and expiry have separate states', async () => {
  const conflict = hostFixture({
    imports: {
      commit: async () => {
        const error = new Error('stale');
        error.code = 'IMPORT_REVISION_CONFLICT';
        throw error;
      },
    },
  });
  await readyCenter(conflict);
  conflict.center.review();
  conflict.center.confirm(true);
  await conflict.center.commit();
  assert.equal(conflict.center.getState().step, 'revision-conflict');

  const cancelled = hostFixture();
  await readyCenter(cancelled);
  await cancelled.center.cancel();
  assert.equal(cancelled.center.getState().step, 'cancelled');
  assert.equal(cancelled.rec.cancels, 1);

  const expired = hostFixture({
    imports: {
      preview: async () => {
        const error = new Error('expired');
        error.code = 'IMPORT_EXPIRED';
        throw error;
      },
    },
  });
  await expired.center.initialize();
  expired.center.selectFile({ files: [{ name: 'old.json', size: 2 }] });
  await expired.center.requestPreview();
  assert.equal(expired.center.getState().step, 'expired');
});

test('lost commit response recovers from completed job status without resubmitting', async () => {
  const fixture = hostFixture({
    imports: {
      commit: async () => {
        fixture.rec.commits++;
        const error = new Error('lost');
        error.code = 'IMPORT_NETWORK';
        throw error;
      },
      getJob: async () => ({
        state: 'completed',
        result: { state: 'completed', operationCount: 1, commitId: 'recovered' },
      }),
    },
  });
  await readyCenter(fixture);
  fixture.center.review();
  fixture.center.confirm(true);
  await fixture.center.commit();
  assert.equal(fixture.center.getState().step, 'completed');
  assert.equal(fixture.center.getState().result.commitId, 'recovered');
  assert.equal(fixture.rec.commits, 1);
});

test('leaving or disposing cancels active work and clears browser-owned state', async () => {
  const fixture = hostFixture();
  await readyCenter(fixture);
  await fixture.center.leave();
  assert.equal(fixture.rec.cancels, 1);
  assert.equal(fixture.center.getState().step, 'select-input');
  assert.equal(fixture.center.getState().fileName, '');

  await readyCenter(fixture);
  await fixture.center.dispose();
  assert.equal(fixture.rec.cancels, 2);
});

test('locale rendering, escaping, focus, live announcements, and player denial are accessible', async () => {
  const hostile = '<img src=x onerror=alert(1)>.json';
  const fixture = hostFixture({ locale: 'cs' });
  await fixture.center.initialize();
  fixture.center.selectFile({ files: [{ name: hostile, size: 2 }] });
  const html = fixture.center.render();
  assert.match(html, /Centrum importu/);
  assert.ok(!html.includes(hostile));
  assert.match(html, /&lt;img/);
  assert.match(html, /<label[^>]*for="dm-import-file"/);
  assert.match(html, /aria-label="Průběh importu"/);
  assert.ok(fixture.rec.focus.includes('dm-import-preview'));
  assert.ok(fixture.rec.announces.length > 0);

  fixture.host.imports.preview = async () => ({
    id: 'job-1',
    previewToken: 'token',
    committable: true,
    plan: plan(
      [{ severity: 'warning', code: 'HOSTILE_CODE', message: '<svg onload=alert(1)>', path: ['scenarios', 0] }],
      [{ id: '<script>alert(1)</script>', value: { name: '<img onerror=alert(1)>', status: 'planned' } }],
    ),
  });
  await fixture.center.requestPreview();
  const previewHtml = fixture.center.render();
  assert.doesNotMatch(previewHtml, /<script>|<svg|<img onerror/);
  assert.match(previewHtml, /&lt;script&gt;/);
  assert.match(previewHtml, /&lt;svg onload=alert\(1\)&gt;/);

  const player = hostFixture({ isDM: false });
  assert.match(player.center.render(), /effective DM/);
  assert.doesNotMatch(player.center.render(), /type="file"/);
});
