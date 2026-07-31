export const PLANNING_SCHEMA_VERSION = 2;

export const PLANNING_KINDS = Object.freeze([
  'plotline',
  'quest',
  'event',
  'branch',
]);

export const EVENT_TYPES = Object.freeze([
  'story',
  'encounter',
  'puzzle',
]);

export const BRANCH_TYPES = Object.freeze([
  'decision',
  'condition',
  'random',
]);

export const FLOW_KINDS = Object.freeze([
  'continues',
  'option',
]);

export const REFERENCE_RELATIONS = Object.freeze([
  'related',
  'involves',
  'features',
  'located-at',
  'opposes',
  'supports',
  'reveals',
  'requires',
  'rewards',
]);

export const CONSEQUENCE_KINDS = Object.freeze([
  'world',
  'reward',
  'information',
  'complication',
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
const ADDON_ID_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const ITEM_KINDS = new Set(PLANNING_KINDS);
const EVENT_KIND_SET = new Set(EVENT_TYPES);
const BRANCH_KIND_SET = new Set(BRANCH_TYPES);
const FLOW_KIND_SET = new Set(FLOW_KINDS);
const RELATIONS = new Set(REFERENCE_RELATIONS);
const CONSEQUENCE_KIND_SET = new Set(CONSEQUENCE_KINDS);
const CORE_COLLECTIONS = new Set(CORE_REFERENCE_COLLECTIONS);

const ITEM_FIELDS = new Set([
  'id',
  'schemaVersion',
  'kind',
  'parentId',
  'title',
  'summary',
  'body',
  'objective',
  'setup',
  'resolution',
  'eventType',
  'branchType',
  'tags',
  'updatedAt',
]);
const FLOW_FIELDS = new Set([
  'id',
  'schemaVersion',
  'sourceId',
  'targetId',
  'kind',
  'label',
  'updatedAt',
]);
const REFERENCE_FIELDS = new Set([
  'id',
  'schemaVersion',
  'itemId',
  'name',
  'relation',
  'target',
  'quantity',
  'notes',
  'updatedAt',
]);
const CONSEQUENCE_FIELDS = new Set([
  'id',
  'schemaVersion',
  'anchor',
  'kind',
  'title',
  'body',
  'target',
  'updatedAt',
]);
const NOTE_FIELDS = new Set([
  'id',
  'schemaVersion',
  'title',
  'body',
  'anchorIds',
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

function id(value, path, errors) {
  const normalized = text(value, path, errors, { required: true, max: 120 });
  if (normalized && (!ID_RE.test(normalized) || FORBIDDEN_IDS.has(normalized))) {
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
    errors.push(issue(
      'PLANNING_TIMESTAMP_INVALID',
      'Expected a non-negative epoch-millisecond integer.',
      path,
    ));
    return 0;
  }
  return value;
}

function schemaVersion(record, path, errors) {
  const value = record.schemaVersion === undefined
    ? PLANNING_SCHEMA_VERSION
    : record.schemaVersion;
  if (value !== PLANNING_SCHEMA_VERSION) {
    errors.push(issue(
      'PLANNING_SCHEMA_UNSUPPORTED',
      `schemaVersion must be ${PLANNING_SCHEMA_VERSION}.`,
      [...path, 'schemaVersion'],
    ));
  }
  return value;
}

function uniqueIds(value, path, errors, maxItems = 100) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    errors.push(issue(
      'PLANNING_LIST_INVALID',
      `Expected an array of at most ${maxItems} ids.`,
      path,
    ));
    return [];
  }
  const seen = new Set();
  const result = [];
  value.forEach((entry, index) => {
    const normalized = id(entry, [...path, index], errors);
    if (seen.has(normalized)) {
      errors.push(issue('PLANNING_DUPLICATE_VALUE', 'Values must be unique.', [...path, index]));
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result.sort();
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
    const normalized = text(entry, [...path, index], errors, {
      required: true,
      max: maxLength,
    });
    const identity = normalized.toLocaleLowerCase('en-US');
    if (!normalized || seen.has(identity)) {
      if (seen.has(identity)) {
        errors.push(issue(
          'PLANNING_DUPLICATE_VALUE',
          'Values must be unique ignoring case.',
          [...path, index],
        ));
      }
      return;
    }
    seen.add(identity);
    result.push(normalized);
  });
  return result.sort((left, right) => left.localeCompare(right, 'en'));
}

export function normalizePlanningItem(record, path = ['items']) {
  const errors = [];
  if (!isObject(record)) {
    return {
      value: null,
      errors: [issue('PLANNING_ITEM_TYPE', 'Planning item must be an object.', path)],
    };
  }
  unknownFields(record, ITEM_FIELDS, path, errors);
  const kind = text(record.kind, [...path, 'kind'], errors, { required: true, max: 40 });
  if (!ITEM_KINDS.has(kind)) {
    errors.push(issue(
      'PLANNING_KIND_INVALID',
      `kind must be one of: ${PLANNING_KINDS.join(', ')}.`,
      [...path, 'kind'],
    ));
  }
  const eventType = record.eventType === undefined
    ? ''
    : text(record.eventType, [...path, 'eventType'], errors, { required: true, max: 40 });
  const branchType = record.branchType === undefined
    ? ''
    : text(record.branchType, [...path, 'branchType'], errors, { required: true, max: 40 });
  if (kind === 'event' && !EVENT_KIND_SET.has(eventType)) {
    errors.push(issue(
      'PLANNING_EVENT_TYPE_INVALID',
      `eventType must be one of: ${EVENT_TYPES.join(', ')}.`,
      [...path, 'eventType'],
    ));
  }
  if (kind !== 'event' && eventType) {
    errors.push(issue(
      'PLANNING_EVENT_TYPE_INVALID',
      'eventType is valid only for event items.',
      [...path, 'eventType'],
    ));
  }
  if (kind === 'branch' && !BRANCH_KIND_SET.has(branchType)) {
    errors.push(issue(
      'PLANNING_BRANCH_TYPE_INVALID',
      `branchType must be one of: ${BRANCH_TYPES.join(', ')}.`,
      [...path, 'branchType'],
    ));
  }
  if (kind !== 'branch' && branchType) {
    errors.push(issue(
      'PLANNING_BRANCH_TYPE_INVALID',
      'branchType is valid only for branch items.',
      [...path, 'branchType'],
    ));
  }
  const value = {
    id: id(record.id, [...path, 'id'], errors),
    schemaVersion: schemaVersion(record, path, errors),
    kind,
    parentId: nullableId(record.parentId, [...path, 'parentId'], errors),
    title: text(record.title, [...path, 'title'], errors, { required: true, max: 160 }),
    summary: text(record.summary, [...path, 'summary'], errors, { max: 2_000 }),
    body: text(record.body, [...path, 'body'], errors, { max: 80_000 }),
    objective: text(record.objective, [...path, 'objective'], errors, { max: 10_000 }),
    setup: text(record.setup, [...path, 'setup'], errors, { max: 30_000 }),
    resolution: text(record.resolution, [...path, 'resolution'], errors, { max: 30_000 }),
    ...(kind === 'event' ? { eventType } : {}),
    ...(kind === 'branch' ? { branchType } : {}),
    tags: uniqueStrings(record.tags, [...path, 'tags'], errors, {
      maxItems: 40,
      maxLength: 60,
    }),
    updatedAt: timestamp(record.updatedAt, [...path, 'updatedAt'], errors),
  };
  return { value: errors.length ? null : value, errors };
}

export function normalizePlanningFlow(record, path = ['flowLinks']) {
  const errors = [];
  if (!isObject(record)) {
    return {
      value: null,
      errors: [issue('PLANNING_FLOW_TYPE', 'Flow link must be an object.', path)],
    };
  }
  unknownFields(record, FLOW_FIELDS, path, errors);
  const kind = record.kind === undefined
    ? 'continues'
    : text(record.kind, [...path, 'kind'], errors, { required: true, max: 40 });
  if (!FLOW_KIND_SET.has(kind)) {
    errors.push(issue(
      'PLANNING_FLOW_KIND_INVALID',
      `kind must be one of: ${FLOW_KINDS.join(', ')}.`,
      [...path, 'kind'],
    ));
  }
  const value = {
    id: id(record.id, [...path, 'id'], errors),
    schemaVersion: schemaVersion(record, path, errors),
    sourceId: id(record.sourceId, [...path, 'sourceId'], errors),
    targetId: id(record.targetId, [...path, 'targetId'], errors),
    kind,
    label: text(record.label, [...path, 'label'], errors, { max: 200 }),
    updatedAt: timestamp(record.updatedAt, [...path, 'updatedAt'], errors),
  };
  if (value.sourceId && value.sourceId === value.targetId) {
    errors.push(issue('PLANNING_FLOW_SELF', 'A flow link must connect two different items.', path));
  }
  return { value: errors.length ? null : value, errors };
}

export function normalizeReferenceTarget(record, path = ['target']) {
  const errors = [];
  if (!isObject(record)) {
    return {
      value: null,
      errors: [issue('PLANNING_TARGET_TYPE', 'Reference target must be an object.', path)],
    };
  }
  if (record.scope === 'core') {
    unknownFields(record, new Set(['scope', 'collection', 'id']), path, errors);
    const collection = text(record.collection, [...path, 'collection'], errors, {
      required: true,
      max: 40,
    });
    if (!CORE_COLLECTIONS.has(collection)) {
      errors.push(issue(
        'PLANNING_CORE_COLLECTION_INVALID',
        `collection must be one of: ${CORE_REFERENCE_COLLECTIONS.join(', ')}.`,
        [...path, 'collection'],
      ));
    }
    return {
      value: {
        scope: 'core',
        collection,
        id: id(record.id, [...path, 'id'], errors),
      },
      errors,
    };
  }
  if (record.scope === 'planning') {
    unknownFields(record, new Set(['scope', 'itemId']), path, errors);
    return {
      value: {
        scope: 'planning',
        itemId: id(record.itemId, [...path, 'itemId'], errors),
      },
      errors,
    };
  }
  if (record.scope === 'external') {
    unknownFields(record, new Set(['scope', 'addonId', 'kind', 'id', 'label']), path, errors);
    const addonId = text(record.addonId, [...path, 'addonId'], errors, {
      required: true,
      max: 39,
    });
    if (!ADDON_ID_RE.test(addonId)) {
      errors.push(issue('PLANNING_ADDON_ID_INVALID', 'addonId is invalid.', [...path, 'addonId']));
    }
    return {
      value: {
        scope: 'external',
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
      'PLANNING_TARGET_SCOPE_INVALID',
      'scope must be planning, core, or external.',
      [...path, 'scope'],
    )],
  };
}

export function normalizePlanningReference(record, path = ['references']) {
  const errors = [];
  if (!isObject(record)) {
    return {
      value: null,
      errors: [issue('PLANNING_REFERENCE_TYPE', 'Named reference must be an object.', path)],
    };
  }
  unknownFields(record, REFERENCE_FIELDS, path, errors);
  const relation = text(record.relation, [...path, 'relation'], errors, {
    required: true,
    max: 40,
  });
  if (!RELATIONS.has(relation)) {
    errors.push(issue(
      'PLANNING_RELATION_INVALID',
      `relation must be one of: ${REFERENCE_RELATIONS.join(', ')}.`,
      [...path, 'relation'],
    ));
  }
  const target = normalizeReferenceTarget(record.target, [...path, 'target']);
  errors.push(...target.errors);
  if (record.quantity !== undefined
      && (!Number.isInteger(record.quantity) || record.quantity < 1 || record.quantity > 1_000)) {
    errors.push(issue(
      'PLANNING_QUANTITY_INVALID',
      'quantity must be an integer from 1 to 1000.',
      [...path, 'quantity'],
    ));
  }
  const value = {
    id: id(record.id, [...path, 'id'], errors),
    schemaVersion: schemaVersion(record, path, errors),
    itemId: id(record.itemId, [...path, 'itemId'], errors),
    name: text(record.name, [...path, 'name'], errors, { required: true, max: 200 }),
    relation,
    target: target.value,
    quantity: Number.isInteger(record.quantity) ? record.quantity : 1,
    notes: text(record.notes, [...path, 'notes'], errors, { max: 2_000 }),
    updatedAt: timestamp(record.updatedAt, [...path, 'updatedAt'], errors),
  };
  return { value: errors.length ? null : value, errors };
}

function normalizeConsequenceAnchor(record, path, errors) {
  if (!isObject(record)) {
    errors.push(issue('PLANNING_ANCHOR_TYPE', 'Consequence anchor must be an object.', path));
    return null;
  }
  if (record.scope === 'item') {
    unknownFields(record, new Set(['scope', 'itemId']), path, errors);
    return { scope: 'item', itemId: id(record.itemId, [...path, 'itemId'], errors) };
  }
  if (record.scope === 'flow') {
    unknownFields(record, new Set(['scope', 'flowId']), path, errors);
    return { scope: 'flow', flowId: id(record.flowId, [...path, 'flowId'], errors) };
  }
  errors.push(issue(
    'PLANNING_ANCHOR_SCOPE_INVALID',
    'scope must be item or flow.',
    [...path, 'scope'],
  ));
  return null;
}

export function normalizePlanningConsequence(record, path = ['consequences']) {
  const errors = [];
  if (!isObject(record)) {
    return {
      value: null,
      errors: [issue('PLANNING_CONSEQUENCE_TYPE', 'Consequence must be an object.', path)],
    };
  }
  unknownFields(record, CONSEQUENCE_FIELDS, path, errors);
  const kind = text(record.kind, [...path, 'kind'], errors, { required: true, max: 40 });
  if (!CONSEQUENCE_KIND_SET.has(kind)) {
    errors.push(issue(
      'PLANNING_CONSEQUENCE_KIND_INVALID',
      `kind must be one of: ${CONSEQUENCE_KINDS.join(', ')}.`,
      [...path, 'kind'],
    ));
  }
  let target;
  if (record.target !== undefined && record.target !== null) {
    const normalized = normalizeReferenceTarget(record.target, [...path, 'target']);
    errors.push(...normalized.errors);
    target = normalized.value;
  }
  const value = {
    id: id(record.id, [...path, 'id'], errors),
    schemaVersion: schemaVersion(record, path, errors),
    anchor: normalizeConsequenceAnchor(record.anchor, [...path, 'anchor'], errors),
    kind,
    title: text(record.title, [...path, 'title'], errors, { required: true, max: 200 }),
    body: text(record.body, [...path, 'body'], errors, { max: 10_000 }),
    ...(target ? { target } : {}),
    updatedAt: timestamp(record.updatedAt, [...path, 'updatedAt'], errors),
  };
  return { value: errors.length ? null : value, errors };
}

export function normalizeDmNote(record, path = ['notes']) {
  const errors = [];
  if (!isObject(record)) {
    return {
      value: null,
      errors: [issue('PLANNING_NOTE_TYPE', 'DM note must be an object.', path)],
    };
  }
  unknownFields(record, NOTE_FIELDS, path, errors);
  const value = {
    id: id(record.id, [...path, 'id'], errors),
    schemaVersion: schemaVersion(record, path, errors),
    title: text(record.title, [...path, 'title'], errors, { required: true, max: 200 }),
    body: text(record.body, [...path, 'body'], errors, { max: 30_000 }),
    anchorIds: uniqueIds(record.anchorIds, [...path, 'anchorIds'], errors),
    updatedAt: timestamp(record.updatedAt, [...path, 'updatedAt'], errors),
  };
  return { value: errors.length ? null : value, errors };
}

function recordMap(records) {
  return new Map(records.map(record => [record.id, record]));
}

function duplicateIds(records, label, errors) {
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
}

function validateHierarchy(items, errors) {
  const byId = recordMap(items);
  for (const item of items) {
    if (item.parentId && !byId.has(item.parentId)) {
      errors.push(issue(
        'PLANNING_PARENT_MISSING',
        `Parent item "${item.parentId}" does not exist.`,
        ['items', item.id, 'parentId'],
      ));
      continue;
    }
    const parent = byId.get(item.parentId);
    if (parent && parent.kind !== 'plotline' && parent.kind !== 'quest') {
      errors.push(issue(
        'PLANNING_PARENT_KIND_INVALID',
        'Only a plotline or quest may contain planning items.',
        ['items', item.id, 'parentId'],
      ));
    }
    const seen = new Set([item.id]);
    let current = item;
    while (current?.parentId) {
      if (seen.has(current.parentId)) {
        errors.push(issue(
          'PLANNING_HIERARCHY_CYCLE',
          'Planning ownership contains a cycle.',
          ['items', item.id, 'parentId'],
        ));
        break;
      }
      seen.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
}

function validateFlow(items, flowLinks, errors) {
  const byId = recordMap(items);
  const adjacency = new Map();
  for (const link of flowLinks) {
    const source = byId.get(link.sourceId);
    const target = byId.get(link.targetId);
    if (!source || !target) {
      errors.push(issue(
        'PLANNING_FLOW_ENDPOINT_MISSING',
        'Flow links must connect existing planning items.',
        ['flowLinks', link.id],
      ));
      continue;
    }
    if (link.kind === 'option' && source.kind !== 'branch') {
      errors.push(issue(
        'PLANNING_FLOW_OPTION_SOURCE_INVALID',
        'Option links must start at a decision, condition, or random branch.',
        ['flowLinks', link.id, 'kind'],
      ));
    }
    if (!adjacency.has(source.id)) adjacency.set(source.id, []);
    adjacency.get(source.id).push({ targetId: target.id, link });
  }
  const state = new Map();
  const visit = nodeId => {
    state.set(nodeId, 'visiting');
    for (const edge of adjacency.get(nodeId) || []) {
      if (state.get(edge.targetId) === 'visiting') {
        errors.push(issue(
          'PLANNING_FLOW_CYCLE',
          'Planned story flow must not contain a cycle.',
          ['flowLinks', edge.link.id],
        ));
        continue;
      }
      if (!state.has(edge.targetId)) visit(edge.targetId);
    }
    state.set(nodeId, 'visited');
  };
  for (const nodeId of adjacency.keys()) {
    if (!state.has(nodeId)) visit(nodeId);
  }
}

function coreSet(coreIds) {
  return new Map(
    CORE_REFERENCE_COLLECTIONS
      .filter(collection => Array.isArray(coreIds[collection]))
      .map(collection => [collection, new Set(coreIds[collection])]),
  );
}

function targetExists(target, core, errors, path) {
  if (!target || target.scope === 'external' || target.scope === 'planning') return;
  const ids = core.get(target.collection);
  if (ids && !ids.has(target.id)) {
    errors.push(issue(
      'PLANNING_CORE_REFERENCE_MISSING',
      `Core ${target.collection} record "${target.id}" does not exist.`,
      path,
    ));
  }
}

export function validatePlanningDataset({
  items = [],
  flowLinks = [],
  references = [],
  consequences = [],
  notes = [],
  coreIds = {},
} = {}) {
  const errors = [];
  duplicateIds(items, 'items', errors);
  duplicateIds(flowLinks, 'flowLinks', errors);
  duplicateIds(references, 'references', errors);
  duplicateIds(consequences, 'consequences', errors);
  duplicateIds(notes, 'notes', errors);
  validateHierarchy(items, errors);
  validateFlow(items, flowLinks, errors);
  const itemsById = recordMap(items);
  const flowById = recordMap(flowLinks);
  const core = coreSet(coreIds);
  for (const reference of references) {
    if (!itemsById.has(reference.itemId)) {
      errors.push(issue(
        'PLANNING_ITEM_REFERENCE_MISSING',
        `Planning item "${reference.itemId}" does not exist.`,
        ['references', reference.id, 'itemId'],
      ));
    }
    if (reference.target?.scope === 'planning') {
      if (!itemsById.has(reference.target.itemId)) {
        errors.push(issue(
          'PLANNING_ITEM_REFERENCE_MISSING',
          `Planning item "${reference.target.itemId}" does not exist.`,
          ['references', reference.id, 'target'],
        ));
      } else if (reference.target.itemId === reference.itemId) {
        errors.push(issue(
          'PLANNING_REFERENCE_SELF',
          'A named reference must connect two different items.',
          ['references', reference.id, 'target'],
        ));
      }
    }
    targetExists(reference.target, core, errors, ['references', reference.id, 'target']);
  }
  for (const consequence of consequences) {
    if (consequence.anchor?.scope === 'item' && !itemsById.has(consequence.anchor.itemId)) {
      errors.push(issue(
        'PLANNING_ITEM_REFERENCE_MISSING',
        `Planning item "${consequence.anchor.itemId}" does not exist.`,
        ['consequences', consequence.id, 'anchor'],
      ));
    }
    if (consequence.anchor?.scope === 'flow' && !flowById.has(consequence.anchor.flowId)) {
      errors.push(issue(
        'PLANNING_FLOW_REFERENCE_MISSING',
        `Flow link "${consequence.anchor.flowId}" does not exist.`,
        ['consequences', consequence.id, 'anchor'],
      ));
    }
    if (consequence.target?.scope === 'planning'
        && !itemsById.has(consequence.target.itemId)) {
      errors.push(issue(
        'PLANNING_ITEM_REFERENCE_MISSING',
        `Planning item "${consequence.target.itemId}" does not exist.`,
        ['consequences', consequence.id, 'target'],
      ));
    }
    targetExists(consequence.target, core, errors, ['consequences', consequence.id, 'target']);
  }
  for (const note of notes) {
    for (const itemId of note.anchorIds) {
      if (!itemsById.has(itemId)) {
        errors.push(issue(
          'PLANNING_ITEM_REFERENCE_MISSING',
          `Planning item "${itemId}" does not exist.`,
          ['notes', note.id, 'anchorIds'],
        ));
      }
    }
  }
  return errors;
}

export function withoutRecordId(record) {
  const value = { ...record };
  delete value.id;
  return value;
}
