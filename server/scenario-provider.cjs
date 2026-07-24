'use strict';

const PROVIDER_ID = 'scenario-json';
const SCHEMA_VERSION = 1;
const TARGET = Object.freeze({
  scope: 'addon',
  addonId: 'dm-tools',
  collection: 'scenarios',
});
const ROOT_FIELDS = new Set(['format', 'schemaVersion', 'scenarios']);
const RECORD_FIELDS = new Set([
  'id', 'operation', 'name', 'summary', 'status', 'tags', 'updatedAt',
  'expectedUpdatedAt',
]);
const STORED_FIELDS = new Set(['id', 'name', 'summary', 'status', 'tags', 'updatedAt']);
const STATUSES = new Set(['planned', 'active', 'completed']);
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function diagnostic(severity, code, message, path) {
  return { severity, code, message, ...(path ? { path } : {}) };
}

function canonicalTime(value, path, diagnostics, required = true) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') {
    diagnostics.push(diagnostic('error', 'SCENARIO_FIELD_TYPE', 'Timestamp must be a string.', path));
    return null;
  }
  const millis = ISO_TIME_RE.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(millis)) {
    diagnostics.push(diagnostic('error', 'SCENARIO_TIMESTAMP_INVALID', 'Timestamp must be a valid ISO date.', path));
    return null;
  }
  return new Date(millis).toISOString();
}

function textField(record, field, path, diagnostics, { max, required = true }) {
  const value = record[field];
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') {
    diagnostics.push(diagnostic('error', 'SCENARIO_FIELD_TYPE', `${field} must be a string.`, [...path, field]));
    return null;
  }
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max) {
    diagnostics.push(diagnostic(
      'error',
      'SCENARIO_FIELD_LENGTH',
      `${field} must contain ${required ? '1' : '0'} to ${max} characters.`,
      [...path, field],
    ));
    return null;
  }
  return normalized;
}

function tagsField(value, path, diagnostics) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    diagnostics.push(diagnostic('error', 'SCENARIO_TAGS_INVALID', 'tags must be an array of at most 20 strings.', path));
    return null;
  }
  const tags = [];
  const identities = new Set();
  for (let index = 0; index < value.length; index++) {
    const raw = value[index];
    if (typeof raw !== 'string') {
      diagnostics.push(diagnostic('error', 'SCENARIO_FIELD_TYPE', 'Each tag must be a string.', [...path, index]));
      continue;
    }
    const tag = raw.trim();
    if (!tag || tag.length > 40) {
      diagnostics.push(diagnostic('error', 'SCENARIO_FIELD_LENGTH', 'Each tag must contain 1 to 40 characters.', [...path, index]));
      continue;
    }
    const identity = tag.toLocaleLowerCase('en-US');
    if (identities.has(identity)) {
      diagnostics.push(diagnostic('error', 'SCENARIO_TAG_DUPLICATE', 'Tags must be unique ignoring case.', [...path, index]));
      continue;
    }
    identities.add(identity);
    tags.push(tag);
  }
  return tags.sort();
}

function normalizeIncoming(record, index, diagnostics) {
  const path = ['scenarios', index];
  if (!isObject(record)) {
    diagnostics.push(diagnostic('error', 'SCENARIO_RECORD_TYPE', 'Scenario record must be an object.', path));
    return null;
  }
  for (const field of Object.keys(record)) {
    if (!RECORD_FIELDS.has(field)) {
      diagnostics.push(diagnostic('error', 'SCENARIO_UNKNOWN_FIELD', `Unknown scenario field "${field}".`, [...path, field]));
    }
  }
  const id = textField(record, 'id', path, diagnostics, { max: 120 });
  if (id && !ID_RE.test(id)) {
    diagnostics.push(diagnostic('error', 'SCENARIO_ID_INVALID', 'id must use lowercase letters, digits, dots, underscores, or hyphens.', [...path, 'id']));
  }
  const operation = record.operation;
  if (operation !== 'create' && operation !== 'update') {
    diagnostics.push(diagnostic('error', 'SCENARIO_OPERATION_INVALID', 'operation must be "create" or "update".', [...path, 'operation']));
  }
  const name = textField(record, 'name', path, diagnostics, { max: 120 });
  const summary = textField(record, 'summary', path, diagnostics, { max: 4000, required: false });
  if (!STATUSES.has(record.status)) {
    diagnostics.push(diagnostic('error', 'SCENARIO_STATUS_INVALID', 'status must be "planned", "active", or "completed".', [...path, 'status']));
  }
  const tags = tagsField(record.tags, [...path, 'tags'], diagnostics);
  const updatedAt = canonicalTime(record.updatedAt, [...path, 'updatedAt'], diagnostics);
  const expectedUpdatedAt = canonicalTime(
    record.expectedUpdatedAt,
    [...path, 'expectedUpdatedAt'],
    diagnostics,
    operation === 'update',
  );
  if (operation === 'create' && record.expectedUpdatedAt !== undefined) {
    diagnostics.push(diagnostic(
      'error',
      'SCENARIO_UNKNOWN_FIELD',
      'expectedUpdatedAt is only valid for update operations.',
      [...path, 'expectedUpdatedAt'],
    ));
  }
  const invalid = diagnostics.some(entry => entry.severity === 'error'
    && entry.path?.[0] === 'scenarios'
    && entry.path?.[1] === index);
  if (invalid || !id || !ID_RE.test(id) || !name || summary === null || !tags || !updatedAt) return null;
  return {
    id,
    operation,
    expectedUpdatedAt,
    value: { name, summary, status: record.status, tags, updatedAt },
    path,
  };
}

function normalizeStored(record) {
  if (!isObject(record) || typeof record.id !== 'string' || !ID_RE.test(record.id)) return null;
  if (Object.keys(record).some(field => !STORED_FIELDS.has(field))) return null;
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.trim().length > 120) return null;
  if (record.summary !== undefined && (typeof record.summary !== 'string' || record.summary.trim().length > 4000)) return null;
  if (!STATUSES.has(record.status)) return null;
  if (!Array.isArray(record.tags) || record.tags.length > 20
      || record.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)) return null;
  const identities = record.tags.map(tag => tag.trim().toLowerCase());
  if (new Set(identities).size !== identities.length) return null;
  const millis = typeof record.updatedAt === 'string' && ISO_TIME_RE.test(record.updatedAt)
    ? Date.parse(record.updatedAt)
    : NaN;
  if (!Number.isFinite(millis)) return null;
  return {
    id: record.id,
    value: {
      name: record.name.trim(),
      summary: typeof record.summary === 'string' ? record.summary.trim() : '',
      status: record.status,
      tags: [...record.tags].map(tag => tag.trim()).sort(),
      updatedAt: new Date(millis).toISOString(),
    },
  };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function previewScenarioImport(input, context) {
  const diagnostics = [];
  const operations = [];
  const source = input.data;
  if (!isObject(source)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      operations,
      diagnostics: [diagnostic('error', 'SCENARIO_DOCUMENT_TYPE', 'Import document must be an object.', [])],
    };
  }
  for (const field of Object.keys(source)) {
    if (!ROOT_FIELDS.has(field)) {
      diagnostics.push(diagnostic('error', 'SCENARIO_UNKNOWN_FIELD', `Unknown document field "${field}".`, [field]));
    }
  }
  if (source.format !== 'dm-tools-scenarios') {
    diagnostics.push(diagnostic('error', 'SCENARIO_FORMAT_UNSUPPORTED', 'format must be "dm-tools-scenarios".', ['format']));
  }
  if (source.schemaVersion !== SCHEMA_VERSION) {
    diagnostics.push(diagnostic('error', 'SCENARIO_SCHEMA_UNSUPPORTED', `schemaVersion must be ${SCHEMA_VERSION}.`, ['schemaVersion']));
  }
  if (!Array.isArray(source.scenarios)) {
    diagnostics.push(diagnostic('error', 'SCENARIO_RECORDS_TYPE', 'scenarios must be an array.', ['scenarios']));
    return { schemaVersion: SCHEMA_VERSION, operations, diagnostics };
  }

  const localRecords = context.read(TARGET);
  const localById = new Map();
  const invalidLocalIds = new Set();
  for (const local of localRecords) {
    const normalized = normalizeStored(local);
    const id = typeof local?.id === 'string' ? local.id : '';
    if (!normalized || localById.has(id)) {
      if (id) invalidLocalIds.add(id);
      continue;
    }
    localById.set(id, normalized);
  }

  const incomingIds = new Map();
  const duplicateIds = new Set();
  const records = source.scenarios.map((record, index) => {
    if (context.signal.aborted) throw context.signal.reason;
    const normalized = normalizeIncoming(record, index, diagnostics);
    if (!normalized) return null;
    const first = incomingIds.get(normalized.id);
    if (first !== undefined) {
      duplicateIds.add(normalized.id);
      diagnostics.push(diagnostic('error', 'SCENARIO_ID_DUPLICATE', `Scenario id "${normalized.id}" is duplicated in the input.`, [...normalized.path, 'id']));
      diagnostics.push(diagnostic('error', 'SCENARIO_ID_DUPLICATE', `Scenario id "${normalized.id}" is duplicated in the input.`, ['scenarios', first, 'id']));
      return null;
    }
    incomingIds.set(normalized.id, index);
    return normalized;
  });

  for (const record of records) {
    if (!record || duplicateIds.has(record.id)) continue;
    if (invalidLocalIds.has(record.id)) {
      diagnostics.push(diagnostic('error', 'SCENARIO_LOCAL_INVALID', 'The local scenario cannot be safely reconciled.', record.path));
      continue;
    }
    const local = localById.get(record.id);
    if (record.operation === 'create') {
      if (!local) {
        operations.push({ target: TARGET, op: 'put', id: record.id, value: record.value });
        diagnostics.push(diagnostic('info', 'SCENARIO_CREATE', 'Scenario will be created.', record.path));
      } else if (sameValue(local.value, record.value)) {
        diagnostics.push(diagnostic('info', 'SCENARIO_SKIP', 'Scenario is unchanged and will be skipped.', record.path));
      } else {
        diagnostics.push(diagnostic('error', 'SCENARIO_CONFLICT', 'Create conflicts with an existing scenario.', record.path));
      }
      continue;
    }
    if (!local) {
      diagnostics.push(diagnostic('error', 'SCENARIO_CONFLICT', 'Update target does not exist.', record.path));
    } else if (sameValue(local.value, record.value)) {
      diagnostics.push(diagnostic('info', 'SCENARIO_SKIP', 'Scenario is unchanged and will be skipped.', record.path));
    } else if (record.expectedUpdatedAt !== local.value.updatedAt) {
      diagnostics.push(diagnostic('error', 'SCENARIO_CONFLICT', 'Local scenario changed after the source was prepared.', record.path));
    } else {
      operations.push({ target: TARGET, op: 'put', id: record.id, value: record.value });
      diagnostics.push(diagnostic('info', 'SCENARIO_UPDATE', 'Scenario will be updated.', record.path));
    }
  }

  return { schemaVersion: SCHEMA_VERSION, operations, diagnostics };
}

function descriptor() {
  return {
    id: PROVIDER_ID,
    apiVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    formats: ['json'],
    reads: [TARGET],
    writes: [TARGET],
    targetTypes: ['addon-list'],
    limits: {
      maxInputBytes: 256 * 1024,
      maxDepth: 8,
      maxRecords: 200,
      maxStringChars: 5000,
      maxOperations: 200,
      timeoutMs: 3000,
    },
    capabilities: ['abort-signal', 'structured-diagnostics'],
    preview: previewScenarioImport,
  };
}

module.exports = {
  PROVIDER_ID,
  SCHEMA_VERSION,
  TARGET,
  descriptor,
  previewScenarioImport,
};
