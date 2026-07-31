'use strict';

const PROVIDER_ID = 'planning-json';
const SCHEMA_VERSION = 2;
const ADDON_ID = 'dm-tools';
const ROOT_FIELDS = new Set([
  'format',
  'schemaVersion',
  'generatedAt',
  'items',
  'flowLinks',
  'references',
  'consequences',
  'notes',
]);
const CONTROL_FIELDS = new Set(['operation', 'expectedUpdatedAt']);
const RECORD_FIELDS = Object.freeze({
  items: new Set([
    'id', 'schemaVersion', 'kind', 'parentId', 'title', 'summary', 'body',
    'objective', 'setup', 'resolution', 'eventType', 'branchType', 'tags',
    'operation', 'expectedUpdatedAt',
  ]),
  flowLinks: new Set([
    'id', 'schemaVersion', 'sourceId', 'targetId', 'kind', 'label',
    'operation', 'expectedUpdatedAt',
  ]),
  references: new Set([
    'id', 'schemaVersion', 'itemId', 'name', 'relation', 'target', 'quantity',
    'notes', 'operation', 'expectedUpdatedAt',
  ]),
  consequences: new Set([
    'id', 'schemaVersion', 'anchor', 'kind', 'title', 'body', 'target',
    'operation', 'expectedUpdatedAt',
  ]),
  notes: new Set([
    'id', 'schemaVersion', 'title', 'body', 'anchorIds',
    'operation', 'expectedUpdatedAt',
  ]),
});
const TARGETS = Object.freeze({
  items: Object.freeze({ scope: 'addon', addonId: ADDON_ID, collection: 'planning_items' }),
  flowLinks: Object.freeze({ scope: 'addon', addonId: ADDON_ID, collection: 'planning_flow_links' }),
  references: Object.freeze({ scope: 'addon', addonId: ADDON_ID, collection: 'planning_references' }),
  consequences: Object.freeze({ scope: 'addon', addonId: ADDON_ID, collection: 'planning_consequences' }),
  notes: Object.freeze({ scope: 'addon', addonId: ADDON_ID, collection: 'dm_notes' }),
});
const CORE_TARGETS = Object.freeze([
  'characters',
  'factions',
  'locations',
  'mysteries',
  'artifacts',
  'events',
].map(collection => Object.freeze({ scope: 'core', collection })));

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function diagnostic(severity, code, message, path) {
  return { severity, code, message, ...(path ? { path } : {}) };
}

function addDiagnostic(diagnostics, entry) {
  if (diagnostics.length < 100) diagnostics.push(entry);
}

function entriesOf(snapshot) {
  if (Array.isArray(snapshot)) return snapshot.map(record => [record?.id, record]);
  if (!isObject(snapshot)) return [];
  return Object.entries(snapshot).map(([id, value]) => [
    id,
    isObject(value) ? { id, ...value } : value,
  ]);
}

function withoutControls(record, generatedAt) {
  return Object.fromEntries([
    ...Object.entries(record).filter(([field]) => !CONTROL_FIELDS.has(field)),
    ['updatedAt', generatedAt],
  ]);
}

function withoutId(record) {
  const value = { ...record };
  delete value.id;
  return value;
}

function comparable(record) {
  const value = structuredClone(record);
  delete value.updatedAt;
  return value;
}

function sameContent(left, right) {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function normalizeStored(snapshot, normalize, label, diagnostics) {
  const records = [];
  const byId = new Map();
  for (const [id, record] of entriesOf(snapshot)) {
    const result = normalize(record, [label, id || '']);
    if (!result.value || byId.has(result.value.id)) {
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_LOCAL_INVALID',
        `The local ${label} collection contains an invalid or duplicate record.`,
        [label, id || ''],
      ));
      continue;
    }
    records.push(result.value);
    byId.set(result.value.id, result.value);
  }
  return { records, byId };
}

function normalizeIncoming({
  records,
  label,
  generatedAt,
  normalize,
  diagnostics,
}) {
  if (!Array.isArray(records)) {
    addDiagnostic(diagnostics, diagnostic(
      'error',
      'PLANNING_RECORDS_TYPE',
      `${label} must be an array.`,
      [label],
    ));
    return [];
  }
  const seen = new Set();
  return records.map((record, index) => {
    const path = [label, index];
    if (!isObject(record)) {
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_RECORD_TYPE',
        `${label} record must be an object.`,
        path,
      ));
      return null;
    }
    for (const field of Object.keys(record)) {
      if (!RECORD_FIELDS[label].has(field)) {
        addDiagnostic(diagnostics, diagnostic(
          'error',
          'PLANNING_UNKNOWN_FIELD',
          `Unknown ${label} field "${field}".`,
          [...path, field],
        ));
      }
    }
    if (record.operation !== 'create' && record.operation !== 'update') {
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_OPERATION_INVALID',
        'operation must be "create" or "update".',
        [...path, 'operation'],
      ));
    }
    if (record.operation === 'update') {
      if (!Number.isSafeInteger(record.expectedUpdatedAt) || record.expectedUpdatedAt < 0) {
        addDiagnostic(diagnostics, diagnostic(
          'error',
          'PLANNING_EXPECTED_REVISION_INVALID',
          'expectedUpdatedAt must be a non-negative epoch-millisecond integer for updates.',
          [...path, 'expectedUpdatedAt'],
        ));
      }
    } else if (record.expectedUpdatedAt !== undefined) {
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_UNKNOWN_FIELD',
        'expectedUpdatedAt is valid only for update operations.',
        [...path, 'expectedUpdatedAt'],
      ));
    }
    const normalized = normalize(withoutControls(record, generatedAt), path);
    normalized.errors.forEach(error => addDiagnostic(diagnostics, diagnostic(
      'error',
      error.code,
      error.message,
      error.path,
    )));
    if (!normalized.value) return null;
    if (seen.has(normalized.value.id)) {
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_DUPLICATE_ID',
        `Duplicate ${label} id "${normalized.value.id}".`,
        [...path, 'id'],
      ));
      return null;
    }
    seen.add(normalized.value.id);
    return {
      operation: record.operation,
      expectedUpdatedAt: record.expectedUpdatedAt,
      value: normalized.value,
      path,
    };
  }).filter(Boolean);
}

function reconcile({
  incoming,
  local,
  target,
  diagnostics,
  operations,
  counts,
}) {
  for (const record of incoming) {
    const current = local.byId.get(record.value.id);
    if (record.operation === 'create') {
      if (!current) {
        operations.push({
          target,
          op: 'put',
          id: record.value.id,
          value: withoutId(record.value),
        });
        local.byId.set(record.value.id, record.value);
        counts.create++;
      } else if (sameContent(current, record.value)) {
        counts.skip++;
      } else {
        counts.conflict++;
        addDiagnostic(diagnostics, diagnostic(
          'error',
          'PLANNING_CONFLICT',
          `Create conflicts with existing record "${record.value.id}".`,
          record.path,
        ));
      }
      continue;
    }
    if (!current) {
      counts.conflict++;
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_CONFLICT',
        `Update target "${record.value.id}" does not exist.`,
        record.path,
      ));
    } else if (sameContent(current, record.value)) {
      counts.skip++;
    } else if (record.expectedUpdatedAt !== current.updatedAt) {
      counts.conflict++;
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_CONFLICT',
        `Record "${record.value.id}" changed after the source was prepared.`,
        record.path,
      ));
    } else if (record.value.updatedAt <= current.updatedAt) {
      counts.conflict++;
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_TIMESTAMP_ORDER_INVALID',
        `generatedAt must be later than the current timestamp for "${record.value.id}".`,
        record.path,
      ));
    } else {
      operations.push({
        target,
        op: 'put',
        id: record.value.id,
        value: withoutId(record.value),
      });
      local.byId.set(record.value.id, record.value);
      counts.update++;
    }
  }
}

function coreIds(context) {
  return Object.fromEntries(CORE_TARGETS.map(target => {
    const snapshot = context.read(target);
    const ids = Array.isArray(snapshot)
      ? snapshot.map(record => record?.id)
      : isObject(snapshot)
        ? Object.keys(snapshot)
        : [];
    return [target.collection, ids.filter(id => typeof id === 'string')];
  }));
}

function summaryDiagnostics(diagnostics, counts) {
  const verbs = {
    create: 'created',
    update: 'updated',
    skip: 'skipped',
  };
  for (const [kind, count] of Object.entries(counts)) {
    if (kind === 'conflict' || !count) continue;
    addDiagnostic(diagnostics, diagnostic(
      'info',
      `PLANNING_${kind.toUpperCase()}`,
      `${count} planning record${count === 1 ? '' : 's'} will be ${verbs[kind]}.`,
    ));
  }
}

function descriptor(contract) {
  const normalizers = {
    items: contract.normalizePlanningItem,
    flowLinks: contract.normalizePlanningFlow,
    references: contract.normalizePlanningReference,
    consequences: contract.normalizePlanningConsequence,
    notes: contract.normalizeDmNote,
  };

  async function preview(input, context) {
    const diagnostics = [];
    const operations = [];
    const source = input.data;
    if (!isObject(source)) {
      return {
        schemaVersion: SCHEMA_VERSION,
        operations,
        diagnostics: [diagnostic(
          'error',
          'PLANNING_DOCUMENT_TYPE',
          'Import document must be an object.',
          [],
        )],
      };
    }
    for (const field of Object.keys(source)) {
      if (!ROOT_FIELDS.has(field)) {
        addDiagnostic(diagnostics, diagnostic(
          'error',
          'PLANNING_UNKNOWN_FIELD',
          `Unknown document field "${field}".`,
          [field],
        ));
      }
    }
    if (source.format !== 'dm-tools-planning') {
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_FORMAT_UNSUPPORTED',
        'format must be "dm-tools-planning".',
        ['format'],
      ));
    }
    if (source.schemaVersion !== SCHEMA_VERSION) {
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_SCHEMA_UNSUPPORTED',
        `schemaVersion must be ${SCHEMA_VERSION}.`,
        ['schemaVersion'],
      ));
    }
    if (!Number.isSafeInteger(source.generatedAt) || source.generatedAt < 0) {
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_TIMESTAMP_INVALID',
        'generatedAt must be a non-negative epoch-millisecond integer.',
        ['generatedAt'],
      ));
    }

    const local = Object.fromEntries(Object.entries(normalizers).map(([label, normalize]) => [
      label,
      normalizeStored(context.read(TARGETS[label]), normalize, label, diagnostics),
    ]));
    const generatedAt = Number.isSafeInteger(source.generatedAt) && source.generatedAt >= 0
      ? source.generatedAt
      : 0;
    const incoming = Object.fromEntries(Object.entries(normalizers).map(([label, normalize]) => [
      label,
      normalizeIncoming({
        records: source[label],
        label,
        generatedAt,
        normalize,
        diagnostics,
      }),
    ]));
    const counts = { create: 0, update: 0, skip: 0, conflict: 0 };
    for (const label of Object.keys(normalizers)) {
      reconcile({
        incoming: incoming[label],
        local: local[label],
        target: TARGETS[label],
        diagnostics,
        operations,
        counts,
      });
    }

    const candidate = Object.fromEntries(Object.keys(normalizers).map(label => [
      label,
      [...local[label].byId.values()],
    ]));
    contract.validatePlanningDataset(candidate).forEach(error => addDiagnostic(
      diagnostics,
      diagnostic('error', error.code, error.message, error.path),
    ));
    contract.validatePlanningDataset({
      ...candidate,
      references: incoming.references.map(record => record.value),
      consequences: incoming.consequences.map(record => record.value),
      notes: incoming.notes.map(record => record.value),
      coreIds: coreIds(context),
    }).forEach(error => addDiagnostic(
      diagnostics,
      diagnostic('error', error.code, error.message, error.path),
    ));
    if (operations.length > 256) {
      operations.length = 0;
      addDiagnostic(diagnostics, diagnostic(
        'error',
        'PLANNING_OPERATION_LIMIT',
        'One import may change at most 256 records. Split the document into ordered batches.',
      ));
    }
    summaryDiagnostics(diagnostics, counts);
    return { schemaVersion: SCHEMA_VERSION, operations, diagnostics };
  }

  return {
    id: PROVIDER_ID,
    apiVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    formats: ['json'],
    reads: [...Object.values(TARGETS), ...CORE_TARGETS],
    writes: Object.values(TARGETS),
    targetTypes: ['addon-keyed'],
    limits: {
      maxInputBytes: 2 * 1024 * 1024,
      maxDepth: 32,
      maxRecords: 10_000,
      maxStringChars: 256 * 1024,
      maxOperations: 256,
      timeoutMs: 5_000,
    },
    capabilities: ['abort-signal', 'structured-diagnostics'],
    preview,
  };
}

module.exports = {
  PROVIDER_ID,
  SCHEMA_VERSION,
  TARGETS,
  CORE_TARGETS,
  descriptor,
};
