export const PLANNING_SCHEMA_VERSION = 1;

export const PLANNING_KINDS = Object.freeze([
  'thread',
  'quest',
  'scenario',
  'encounter',
  'note',
]);

export const PLANNING_STATES = Object.freeze([
  'idea',
  'ready',
  'active',
  'resolved',
  'archived',
]);

export const PLANNING_RELATIONS = Object.freeze([
  'related',
  'involves',
  'supports',
  'opposes',
  'reveals',
  'requires',
]);

export const CORE_REFERENCE_COLLECTIONS = Object.freeze([
  'characters',
  'factions',
  'locations',
  'mysteries',
  'artifacts',
  'events',
]);

const FORBIDDEN_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const SECTION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const ADDON_ID_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const KINDS = new Set(PLANNING_KINDS);
const STATES = new Set(PLANNING_STATES);
const RELATIONS = new Set(PLANNING_RELATIONS);
const CORE_COLLECTIONS = new Set(CORE_REFERENCE_COLLECTIONS);

const ITEM_FIELDS = new Set([
  'id',
  'schemaVersion',
  'kind',
  'title',
  'summary',
  'body',
  'folderId',
  'tags',
  'state',
  'pinned',
  'sections',
  'updatedAt',
]);
const FOLDER_FIELDS = new Set([
  'id',
  'schemaVersion',
  'name',
  'parentId',
  'order',
  'updatedAt',
]);
const LINK_FIELDS = new Set([
  'id',
  'schemaVersion',
  'name',
  'type',
  'source',
  'target',
  'notes',
  'updatedAt',
]);

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function issue(code, message, path) {
  return { code, message, path };
}

function unknownFields(record, allowed, path, errors) {
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      errors.push(issue('PLANNING_UNKNOWN_FIELD', `Unknown field "${field}".`, [...path, field]));
    }
  }
}

function text(value, path, errors, {
  required = false,
  max = 1_000,
  fallback = '',
} = {}) {
  if (value === undefined || value === null) {
    if (required) errors.push(issue('PLANNING_FIELD_REQUIRED', 'A value is required.', path));
    return fallback;
  }
  if (typeof value !== 'string') {
    errors.push(issue('PLANNING_FIELD_TYPE', 'Expected a string.', path));
    return fallback;
  }
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max) {
    errors.push(issue(
      'PLANNING_FIELD_LENGTH',
      `Expected ${required ? '1' : '0'} to ${max} characters.`,
      path,
    ));
  }
  return normalized;
}

function id(value, path, errors, pattern = ID_RE) {
  const normalized = text(value, path, errors, { required: true, max: 120 });
  if (normalized && (!pattern.test(normalized) || FORBIDDEN_IDS.has(normalized))) {
    errors.push(issue(
      'PLANNING_ID_INVALID',
      'Use lowercase letters, digits, dots, underscores, or hyphens.',
      path,
    ));
  }
  return normalized;
}

function nullableId(value, path, errors) {
  if (value === undefined || value === null || value === '') return null;
  return id(value, path, errors);
}

function timestamp(value, path, errors) {
  if (!Number.isSafeInteger(value) || value < 0) {
    errors.push(issue('PLANNING_TIMESTAMP_INVALID', 'Expected a non-negative epoch-millisecond integer.', path));
    return 0;
  }
  return value;
}

function uniqueStrings(value, path, errors, { maxItems, maxLength }) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    errors.push(issue(
      'PLANNING_LIST_INVALID',
      `Expected an array of at most ${maxItems} strings.`,
      path,
    ));
    return [];
  }
  const seen = new Set();
  const result = [];
  value.forEach((entry, index) => {
    const normalized = text(entry, [...path, index], errors, { required: true, max: maxLength });
    const identity = normalized.toLocaleLowerCase('en-US');
    if (!normalized || seen.has(identity)) {
      if (seen.has(identity)) {
        errors.push(issue('PLANNING_DUPLICATE_VALUE', 'Values must be unique ignoring case.', [...path, index]));
      }
      return;
    }
    seen.add(identity);
    result.push(normalized);
  });
  return result.sort((left, right) => left.localeCompare(right, 'en'));
}

function normalizeSections(value, path, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 80) {
    errors.push(issue('PLANNING_SECTIONS_INVALID', 'Expected at most 80 named sections.', path));
    return [];
  }
  const seen = new Set();
  const result = [];
  value.forEach((entry, index) => {
    const sectionPath = [...path, index];
    if (!isObject(entry)) {
      errors.push(issue('PLANNING_SECTION_TYPE', 'Section must be an object.', sectionPath));
      return;
    }
    unknownFields(entry, new Set(['id', 'title', 'body']), sectionPath, errors);
    const sectionId = id(entry.id, [...sectionPath, 'id'], errors, SECTION_ID_RE);
    if (seen.has(sectionId)) {
      errors.push(issue('PLANNING_SECTION_DUPLICATE', 'Section ids must be unique within an item.', [...sectionPath, 'id']));
    }
    seen.add(sectionId);
    result.push({
      id: sectionId,
      title: text(entry.title, [...sectionPath, 'title'], errors, { required: true, max: 160 }),
      body: text(entry.body, [...sectionPath, 'body'], errors, { max: 30_000 }),
    });
  });
  return result;
}

export function normalizePlanningItem(record, path = ['items']) {
  const errors = [];
  if (!isObject(record)) {
    return { value: null, errors: [issue('PLANNING_ITEM_TYPE', 'Planning item must be an object.', path)] };
  }
  unknownFields(record, ITEM_FIELDS, path, errors);
  const kind = text(record.kind, [...path, 'kind'], errors, { required: true, max: 40 });
  if (!KINDS.has(kind)) {
    errors.push(issue(
      'PLANNING_KIND_INVALID',
      `kind must be one of: ${PLANNING_KINDS.join(', ')}.`,
      [...path, 'kind'],
    ));
  }
  const state = record.state === undefined ? 'idea' : text(
    record.state,
    [...path, 'state'],
    errors,
    { required: true, max: 40 },
  );
  if (!STATES.has(state)) {
    errors.push(issue(
      'PLANNING_STATE_INVALID',
      `state must be one of: ${PLANNING_STATES.join(', ')}.`,
      [...path, 'state'],
    ));
  }
  if (record.pinned !== undefined && typeof record.pinned !== 'boolean') {
    errors.push(issue('PLANNING_FIELD_TYPE', 'pinned must be a boolean.', [...path, 'pinned']));
  }
  const value = {
    id: id(record.id, [...path, 'id'], errors),
    schemaVersion: record.schemaVersion === undefined
      ? PLANNING_SCHEMA_VERSION
      : record.schemaVersion,
    kind,
    title: text(record.title, [...path, 'title'], errors, { required: true, max: 160 }),
    summary: text(record.summary, [...path, 'summary'], errors, { max: 2_000 }),
    body: text(record.body, [...path, 'body'], errors, { max: 80_000 }),
    folderId: nullableId(record.folderId, [...path, 'folderId'], errors),
    tags: uniqueStrings(record.tags, [...path, 'tags'], errors, { maxItems: 40, maxLength: 60 }),
    state,
    pinned: record.pinned === true,
    sections: normalizeSections(record.sections, [...path, 'sections'], errors),
    updatedAt: timestamp(record.updatedAt, [...path, 'updatedAt'], errors),
  };
  if (value.schemaVersion !== PLANNING_SCHEMA_VERSION) {
    errors.push(issue(
      'PLANNING_SCHEMA_UNSUPPORTED',
      `schemaVersion must be ${PLANNING_SCHEMA_VERSION}.`,
      [...path, 'schemaVersion'],
    ));
  }
  return { value: errors.length ? null : value, errors };
}

export function normalizePlanningFolder(record, path = ['folders']) {
  const errors = [];
  if (!isObject(record)) {
    return { value: null, errors: [issue('PLANNING_FOLDER_TYPE', 'Folder must be an object.', path)] };
  }
  unknownFields(record, FOLDER_FIELDS, path, errors);
  if (record.order !== undefined && (!Number.isInteger(record.order) || record.order < 0 || record.order > 1_000_000)) {
    errors.push(issue('PLANNING_ORDER_INVALID', 'order must be an integer from 0 to 1000000.', [...path, 'order']));
  }
  const value = {
    id: id(record.id, [...path, 'id'], errors),
    schemaVersion: record.schemaVersion === undefined
      ? PLANNING_SCHEMA_VERSION
      : record.schemaVersion,
    name: text(record.name, [...path, 'name'], errors, { required: true, max: 160 }),
    parentId: nullableId(record.parentId, [...path, 'parentId'], errors),
    order: Number.isInteger(record.order) ? record.order : 0,
    updatedAt: timestamp(record.updatedAt, [...path, 'updatedAt'], errors),
  };
  if (value.schemaVersion !== PLANNING_SCHEMA_VERSION) {
    errors.push(issue(
      'PLANNING_SCHEMA_UNSUPPORTED',
      `schemaVersion must be ${PLANNING_SCHEMA_VERSION}.`,
      [...path, 'schemaVersion'],
    ));
  }
  return { value: errors.length ? null : value, errors };
}

export function normalizePlanningEndpoint(record, path = ['endpoint']) {
  const errors = [];
  if (!isObject(record)) {
    return { value: null, errors: [issue('PLANNING_ENDPOINT_TYPE', 'Endpoint must be an object.', path)] };
  }
  const scope = record.scope;
  if (scope === 'planning') {
    unknownFields(record, new Set(['scope', 'itemId', 'sectionId']), path, errors);
    return {
      value: {
        scope,
        itemId: id(record.itemId, [...path, 'itemId'], errors),
        ...(record.sectionId
          ? { sectionId: id(record.sectionId, [...path, 'sectionId'], errors, SECTION_ID_RE) }
          : {}),
      },
      errors,
    };
  }
  if (scope === 'core') {
    unknownFields(record, new Set(['scope', 'collection', 'id']), path, errors);
    const collection = text(record.collection, [...path, 'collection'], errors, { required: true, max: 40 });
    if (!CORE_COLLECTIONS.has(collection)) {
      errors.push(issue(
        'PLANNING_CORE_COLLECTION_INVALID',
        `collection must be one of: ${CORE_REFERENCE_COLLECTIONS.join(', ')}.`,
        [...path, 'collection'],
      ));
    }
    return {
      value: {
        scope,
        collection,
        id: id(record.id, [...path, 'id'], errors),
      },
      errors,
    };
  }
  if (scope === 'external') {
    unknownFields(record, new Set(['scope', 'addonId', 'kind', 'id', 'label']), path, errors);
    const addonId = text(record.addonId, [...path, 'addonId'], errors, { required: true, max: 39 });
    if (!ADDON_ID_RE.test(addonId)) {
      errors.push(issue('PLANNING_ADDON_ID_INVALID', 'addonId is invalid.', [...path, 'addonId']));
    }
    return {
      value: {
        scope,
        addonId,
        kind: text(record.kind, [...path, 'kind'], errors, { required: true, max: 80 }),
        id: id(record.id, [...path, 'id'], errors),
        label: text(record.label, [...path, 'label'], errors, { required: true, max: 200 }),
      },
      errors,
    };
  }
  return {
    value: null,
    errors: [issue(
      'PLANNING_ENDPOINT_SCOPE_INVALID',
      'scope must be planning, core, or external.',
      [...path, 'scope'],
    )],
  };
}

function endpointIdentity(endpoint) {
  if (endpoint.scope === 'planning') {
    return `planning:${endpoint.itemId}:${endpoint.sectionId || ''}`;
  }
  if (endpoint.scope === 'core') return `core:${endpoint.collection}:${endpoint.id}`;
  return `external:${endpoint.addonId}:${endpoint.kind}:${endpoint.id}`;
}

export function normalizePlanningLink(record, path = ['links']) {
  const errors = [];
  if (!isObject(record)) {
    return { value: null, errors: [issue('PLANNING_LINK_TYPE', 'Link must be an object.', path)] };
  }
  unknownFields(record, LINK_FIELDS, path, errors);
  const type = text(record.type, [...path, 'type'], errors, { required: true, max: 40 });
  if (!RELATIONS.has(type)) {
    errors.push(issue(
      'PLANNING_RELATION_INVALID',
      `type must be one of: ${PLANNING_RELATIONS.join(', ')}.`,
      [...path, 'type'],
    ));
  }
  const source = normalizePlanningEndpoint(record.source, [...path, 'source']);
  const target = normalizePlanningEndpoint(record.target, [...path, 'target']);
  errors.push(...source.errors, ...target.errors);
  if (source.value && target.value && endpointIdentity(source.value) === endpointIdentity(target.value)) {
    errors.push(issue('PLANNING_LINK_SELF', 'A link must connect two different endpoints.', path));
  }
  const value = {
    id: id(record.id, [...path, 'id'], errors),
    schemaVersion: record.schemaVersion === undefined
      ? PLANNING_SCHEMA_VERSION
      : record.schemaVersion,
    name: text(record.name, [...path, 'name'], errors, { required: true, max: 200 }),
    type,
    source: source.value,
    target: target.value,
    notes: text(record.notes, [...path, 'notes'], errors, { max: 2_000 }),
    updatedAt: timestamp(record.updatedAt, [...path, 'updatedAt'], errors),
  };
  if (value.schemaVersion !== PLANNING_SCHEMA_VERSION) {
    errors.push(issue(
      'PLANNING_SCHEMA_UNSUPPORTED',
      `schemaVersion must be ${PLANNING_SCHEMA_VERSION}.`,
      [...path, 'schemaVersion'],
    ));
  }
  return { value: errors.length ? null : value, errors };
}

function recordMap(records) {
  return new Map(records.map(record => [record.id, record]));
}

function validateFolderGraph(folders, errors) {
  const byId = recordMap(folders);
  for (const folder of folders) {
    if (folder.parentId && !byId.has(folder.parentId)) {
      errors.push(issue(
        'PLANNING_FOLDER_PARENT_MISSING',
        `Folder parent "${folder.parentId}" does not exist.`,
        ['folders', folder.id, 'parentId'],
      ));
    }
    const seen = new Set([folder.id]);
    let current = folder;
    while (current?.parentId) {
      if (seen.has(current.parentId)) {
        errors.push(issue(
          'PLANNING_FOLDER_CYCLE',
          'Folder hierarchy contains a cycle.',
          ['folders', folder.id, 'parentId'],
        ));
        break;
      }
      seen.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
}

function endpointExists(endpoint, items, core, errors, path) {
  if (endpoint.scope === 'external') return;
  if (endpoint.scope === 'core') {
    const ids = core.get(endpoint.collection);
    if (ids && !ids.has(endpoint.id)) {
      errors.push(issue(
        'PLANNING_CORE_REFERENCE_MISSING',
        `Core ${endpoint.collection} record "${endpoint.id}" does not exist.`,
        path,
      ));
    }
    return;
  }
  const item = items.get(endpoint.itemId);
  if (!item) {
    errors.push(issue(
      'PLANNING_ITEM_REFERENCE_MISSING',
      `Planning item "${endpoint.itemId}" does not exist.`,
      path,
    ));
    return;
  }
  if (endpoint.sectionId && !item.sections.some(section => section.id === endpoint.sectionId)) {
    errors.push(issue(
      'PLANNING_SECTION_REFERENCE_MISSING',
      `Section "${endpoint.sectionId}" does not exist in item "${endpoint.itemId}".`,
      path,
    ));
  }
}

export function validatePlanningDataset({
  items = [],
  folders = [],
  links = [],
  coreIds = {},
} = {}) {
  const errors = [];
  const duplicate = (records, label) => {
    const seen = new Set();
    for (const record of records) {
      if (seen.has(record.id)) {
        errors.push(issue(
          'PLANNING_DUPLICATE_ID',
          `Duplicate ${label} id "${record.id}".`,
          [label, record.id],
        ));
      }
      seen.add(record.id);
    }
  };
  duplicate(items, 'items');
  duplicate(folders, 'folders');
  duplicate(links, 'links');
  validateFolderGraph(folders, errors);
  const foldersById = recordMap(folders);
  const itemsById = recordMap(items);
  for (const item of items) {
    if (item.folderId && !foldersById.has(item.folderId)) {
      errors.push(issue(
        'PLANNING_FOLDER_REFERENCE_MISSING',
        `Folder "${item.folderId}" does not exist.`,
        ['items', item.id, 'folderId'],
      ));
    }
  }
  const core = new Map(
    CORE_REFERENCE_COLLECTIONS
      .filter(collection => Array.isArray(coreIds[collection]))
      .map(collection => [collection, new Set(coreIds[collection])]),
  );
  for (const link of links) {
    endpointExists(link.source, itemsById, core, errors, ['links', link.id, 'source']);
    endpointExists(link.target, itemsById, core, errors, ['links', link.id, 'target']);
  }
  return errors;
}

export function withoutRecordId(record) {
  const value = { ...record };
  delete value.id;
  return value;
}
