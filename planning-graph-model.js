const MAX_COORDINATE = 1_000_000;

function hash(value, seed) {
  let result = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

export function graphId(prefix, identity) {
  return `${prefix}:${hash(identity, 2166136261)}${hash(identity, 3339675911)}`;
}

export function coreRecords(value) {
  if (Array.isArray(value)) return value;
  return Object.entries(value || {}).map(([id, record]) => (
    record && typeof record === 'object' ? { id, ...record } : { id }
  ));
}

export function endpointIdentity(endpoint) {
  if (endpoint.scope === 'planning') {
    return `planning:${endpoint.itemId}:${endpoint.sectionId || ''}`;
  }
  if (endpoint.scope === 'core') return `core:${endpoint.collection}:${endpoint.id}`;
  return `external:${endpoint.addonId}:${endpoint.kind}:${endpoint.id}`;
}

function validPosition(value) {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Math.abs(value.x) <= MAX_COORDINATE
    && Math.abs(value.y) <= MAX_COORDINATE;
}

export function normalizePlanningPositions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .filter(([identity, position]) => (
      typeof identity === 'string'
      && identity.length > 0
      && identity.length <= 500
      && validPosition(position)
    ))
    .slice(0, 1000)
    .map(([identity, position]) => [
      identity,
      Object.freeze({ x: position.x, y: position.y }),
    ]);
  return Object.freeze(Object.fromEntries(entries));
}

export function arrangePlanningNodes(nodes, nodeMeta) {
  const rows = { world: 0, plans: 0, sections: 0 };
  const positions = new Map();
  const kindOffset = new Map([
    ['thread', -150],
    ['quest', -75],
    ['scenario', 0],
    ['encounter', 75],
    ['note', 150],
  ]);
  for (const node of nodes) {
    const meta = nodeMeta.get(node.id) || {};
    let lane = 'world';
    let x = -520;
    if (meta.scope === 'planning' && meta.sectionId) {
      lane = 'sections';
      x = 520;
    } else if (meta.scope === 'planning') {
      lane = 'plans';
      x = kindOffset.get(meta.itemKind) || 0;
    }
    const row = rows[lane]++;
    positions.set(node.id, Object.freeze({
      x,
      y: row * 116,
    }));
  }
  return positions;
}

export function planningToGraph({
  items = [],
  links = [],
  core = {},
  expandedItems = [],
  positions = {},
  sectionLabel = 'section',
} = {}) {
  const expanded = new Set(expandedItems);
  const normalizedPositions = normalizePlanningPositions(positions);
  const itemById = new Map(items.map(item => [item.id, item]));
  const coreByCollection = new Map(Object.entries(core).map(([collection, values]) => [
    collection,
    new Map(coreRecords(values).map(record => [record.id, record])),
  ]));
  let nodes = [];
  const edges = [];
  const nodeMeta = new Map();
  const nodesByIdentity = new Map();

  function addNode(identity, label, kind, meta) {
    if (nodesByIdentity.has(identity)) return nodesByIdentity.get(identity);
    const id = graphId('node', identity);
    nodesByIdentity.set(identity, id);
    nodes.push({ id, label, kind });
    nodeMeta.set(id, { ...meta, identity, label });
    return id;
  }

  function itemNode(item) {
    return addNode(
      `planning:${item.id}`,
      item.title,
      `planning-${item.kind}`,
      {
        scope: 'planning',
        itemId: item.id,
        itemKind: item.kind,
        item,
      },
    );
  }

  for (const item of items) {
    const parentId = itemNode(item);
    if (!expanded.has(item.id)) continue;
    for (const section of item.sections || []) {
      const sectionId = addNode(
        `planning:${item.id}:${section.id}`,
        section.title,
        'planning-section',
        {
          scope: 'planning',
          itemId: item.id,
          itemKind: item.kind,
          sectionId: section.id,
          item,
          section,
        },
      );
      edges.push({
        id: graphId('edge', `contains:${item.id}:${section.id}`),
        source: parentId,
        target: sectionId,
        label: sectionLabel,
      });
    }
  }

  function endpointNode(endpoint) {
    if (endpoint.scope === 'planning') {
      const item = itemById.get(endpoint.itemId);
      if (!item) return null;
      if (endpoint.sectionId && expanded.has(item.id)) {
        const section = item.sections?.find(value => value.id === endpoint.sectionId);
        if (!section) return null;
        return addNode(
          endpointIdentity(endpoint),
          section.title,
          'planning-section',
          {
            scope: 'planning',
            itemId: item.id,
            itemKind: item.kind,
            sectionId: section.id,
            item,
            section,
          },
        );
      }
      return itemNode(item);
    }
    if (endpoint.scope === 'core') {
      const record = coreByCollection.get(endpoint.collection)?.get(endpoint.id);
      return addNode(
        endpointIdentity(endpoint),
        record?.name || record?.title || endpoint.id,
        `core-${endpoint.collection}`,
        { ...endpoint, record },
      );
    }
    return addNode(
      endpointIdentity(endpoint),
      endpoint.label,
      `external-${endpoint.kind}`,
      { ...endpoint },
    );
  }

  for (const link of links) {
    const source = endpointNode(link.source);
    const target = endpointNode(link.target);
    if (!source || !target) continue;
    edges.push({
      id: graphId('edge', `link:${link.id}`),
      source,
      target,
      label: link.name,
    });
  }

  nodes.sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  ));
  const arranged = arrangePlanningNodes(nodes, nodeMeta);
  nodes = nodes.map(node => {
    const identity = nodeMeta.get(node.id)?.identity;
    return {
      ...node,
      position: normalizedPositions[identity] || arranged.get(node.id),
    };
  });
  edges.sort((left, right) => left.id.localeCompare(right.id));
  return {
    nodes,
    edges,
    nodeMeta,
    nodesByIdentity,
  };
}
