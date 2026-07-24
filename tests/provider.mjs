import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { createMockImportHost } = require('../../ttrpg-codex/server/addon-import-harness.cjs');
const { descriptor, PROVIDER_ID, TARGET } = require('../server/scenario-provider.cjs');
const manifest = JSON.parse(await readFile(new URL('../addon.json', import.meta.url), 'utf8'));

const stamp = '2026-07-24T10:00:00.000Z';

function record(overrides = {}) {
  return {
    id: 'opening-scene',
    operation: 'create',
    name: 'Opening scene',
    summary: 'Meet at the inn.',
    status: 'planned',
    tags: ['intro'],
    updatedAt: stamp,
    ...overrides,
  };
}

function document(scenarios, overrides = {}) {
  return {
    format: 'dm-tools-scenarios',
    schemaVersion: 1,
    scenarios,
    ...overrides,
  };
}

function harness(seed = [], opts = {}) {
  const instance = createMockImportHost({
    id: manifest.id,
    apiVersion: manifest.apiVersion,
    capabilities: manifest.capabilities,
    permissions: manifest.permissions,
    collections: manifest.collections,
    contentRevision: 'dm-tools-test',
  }, { collections: { scenarios: seed }, ...opts });
  instance.host.registerImportProvider(descriptor());
  return instance;
}

async function preview(instance, value) {
  const job = instance.createJob(PROVIDER_ID, value);
  return instance.manager.preview(job.id, 'mock-session');
}

test('valid scenario preview performs no write and exact commit uses one event', async () => {
  const instance = harness();
  const ready = await preview(instance, document([record()]));
  assert.equal(ready.committable, true);
  assert.equal(ready.plan.operations[0].id, 'opening-scene');
  assert.equal(ready.plan.operations[0].value.name, 'Opening scene');
  assert.equal(ready.plan.diagnostics[0].code, 'SCENARIO_CREATE');
  assert.deepEqual(instance.collection('scenarios'), []);
  assert.equal(instance.events(), 0);

  const result = await instance.manager.commit(
    ready.id,
    'mock-session',
    ready.previewToken,
  );
  assert.equal(result.operationCount, 1);
  assert.deepEqual(instance.collection('scenarios'), [{
    id: 'opening-scene',
    name: 'Opening scene',
    summary: 'Meet at the inn.',
    status: 'planned',
    tags: ['intro'],
    updatedAt: stamp,
  }]);
  assert.equal(instance.events(), 1);
  await instance.dispose();
});

test('unsupported schema, malformed records, and unknown fields report stable locations', async () => {
  const instance = harness();
  const ready = await preview(instance, document([
    { ...record(), name: 42, unsafe: '<script>' },
  ], { schemaVersion: 9, extra: true }));
  assert.equal(ready.committable, false);
  const diagnostics = ready.plan.diagnostics;
  assert.ok(diagnostics.some(item => item.code === 'SCENARIO_SCHEMA_UNSUPPORTED'
    && item.path.join('.') === 'schemaVersion'));
  assert.ok(diagnostics.some(item => item.code === 'SCENARIO_UNKNOWN_FIELD'
    && item.path.join('.') === 'extra'));
  assert.ok(diagnostics.some(item => item.code === 'SCENARIO_FIELD_TYPE'
    && item.path.join('.') === 'scenarios.0.name'));
  assert.ok(diagnostics.some(item => item.code === 'SCENARIO_UNKNOWN_FIELD'
    && item.path.join('.') === 'scenarios.0.unsafe'));
  await assert.rejects(
    instance.manager.commit(ready.id, 'mock-session', ready.previewToken),
    error => error.code === 'IMPORT_PLAN_INVALID',
  );
  assert.deepEqual(instance.collection('scenarios'), []);
  await instance.dispose();
});

test('duplicate identities are rejected at both input locations', async () => {
  const instance = harness();
  const ready = await preview(instance, document([
    record(),
    record({ name: 'Duplicate' }),
  ]));
  const duplicates = ready.plan.diagnostics.filter(item => item.code === 'SCENARIO_ID_DUPLICATE');
  assert.deepEqual(duplicates.map(item => item.path), [
    ['scenarios', 1, 'id'],
    ['scenarios', 0, 'id'],
  ]);
  assert.equal(ready.plan.operations.length, 0);
  await instance.dispose();
});

test('create, update, skip, and conflict behavior is deterministic', async () => {
  const local = {
    id: 'local',
    name: 'Local',
    summary: '',
    status: 'active',
    tags: [],
    updatedAt: stamp,
  };
  const instance = harness([local, { ...local, id: 'conflicted' }]);
  const ready = await preview(instance, document([
    record({ id: 'new' }),
    record({ id: 'local', name: 'Local', summary: '', status: 'active', tags: [] }),
    record({
      id: 'conflicted',
      operation: 'update',
      name: 'Changed',
      expectedUpdatedAt: '2026-07-23T10:00:00Z',
    }),
  ]));
  assert.equal(ready.committable, false);
  assert.ok(ready.plan.diagnostics.some(item => item.code === 'SCENARIO_CREATE'));
  assert.ok(ready.plan.diagnostics.some(item => item.code === 'SCENARIO_SKIP'));
  assert.ok(ready.plan.diagnostics.some(item => item.code === 'SCENARIO_CONFLICT'));
  assert.equal(ready.plan.operations.length, 1);
  await instance.dispose();

  const updateInstance = harness([local]);
  const update = await preview(updateInstance, document([record({
    id: 'local',
    operation: 'update',
    name: 'Changed',
    expectedUpdatedAt: stamp,
  })]));
  assert.equal(update.committable, true);
  assert.equal(update.plan.diagnostics[0].code, 'SCENARIO_UPDATE');
  await updateInstance.dispose();
});

test('provider disposal invalidates outstanding previews', async () => {
  const instance = createMockImportHost({
    id: manifest.id,
    apiVersion: manifest.apiVersion,
    capabilities: manifest.capabilities,
    permissions: manifest.permissions,
    collections: manifest.collections,
    contentRevision: 'dm-tools-test',
  }, { collections: { scenarios: [] } });
  const unregister = instance.host.registerImportProvider(descriptor());
  const job = instance.createJob(PROVIDER_ID, document([record()]));
  const ready = await instance.manager.preview(job.id, 'mock-session');
  unregister();
  assert.equal(instance.manager.getJob(job.id, 'mock-session').state, 'cancelled');
  await assert.rejects(
    instance.manager.commit(job.id, 'mock-session', ready.previewToken),
    error => error.code === 'IMPORT_TOKEN_USED',
  );
  assert.deepEqual(instance.collection('scenarios'), []);
  await instance.dispose();
});

test('revision conflict and injected commit failure leave scenarios unchanged', async () => {
  const instance = harness();
  const ready = await preview(instance, document([record()]));
  instance.setCollection(TARGET, [{
    id: 'concurrent',
    name: 'Concurrent',
    summary: '',
    status: 'planned',
    tags: [],
    updatedAt: stamp,
  }]);
  await assert.rejects(
    instance.manager.commit(ready.id, 'mock-session', ready.previewToken),
    error => error.code === 'IMPORT_REVISION_CONFLICT',
  );
  assert.equal(instance.events(), 0);
  await instance.dispose();

  const failing = harness([], { failCommit: true });
  const failingReady = await preview(failing, document([record()]));
  await assert.rejects(
    failing.manager.commit(failingReady.id, 'mock-session', failingReady.previewToken),
    error => error.code === 'IMPORT_COMMIT_FAILED',
  );
  assert.deepEqual(failing.collection('scenarios'), []);
  assert.equal(failing.events(), 0);
  await failing.dispose();
});
