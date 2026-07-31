const MAX_COORDINATE = 1_000_000;
const GRID = 24;

export function records(value) {
  if (Array.isArray(value)) return value;
  return Object.entries(value || {}).map(([id, record]) => (
    record && typeof record === 'object' ? { id, ...record } : { id }
  ));
}

export function normalizePositions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, position]) => (
    typeof id === 'string'
    && id.length > 0
    && id.length <= 120
    && position
    && typeof position === 'object'
    && !Array.isArray(position)
    && Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Math.abs(position.x) <= MAX_COORDINATE
    && Math.abs(position.y) <= MAX_COORDINATE
  )).map(([id, position]) => [id, {
    x: Math.round(position.x / GRID) * GRID,
    y: Math.round(position.y / GRID) * GRID,
  }]));
}

export function itemAncestors(itemId, items) {
  const byId = new Map(items.map(item => [item.id, item]));
  const result = [];
  const seen = new Set();
  let current = byId.get(itemId);
  while (current) {
    if (seen.has(current.id)) return [];
    seen.add(current.id);
    result.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return result;
}

function directChildFor(itemId, scopeId, byId) {
  let current = byId.get(itemId);
  const seen = new Set();
  while (current && current.parentId !== scopeId) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return current?.parentId === scopeId ? current : null;
}

function arrange(items, edges) {
  const itemIds = new Set(items.map(item => item.id));
  const incoming = new Map(items.map(item => [item.id, 0]));
  const outgoing = new Map(items.map(item => [item.id, []]));
  for (const edge of edges) {
    if (!itemIds.has(edge.sourceId) || !itemIds.has(edge.targetId)) continue;
    incoming.set(edge.targetId, (incoming.get(edge.targetId) || 0) + 1);
    outgoing.get(edge.sourceId).push(edge.targetId);
  }
  const queue = items
    .filter(item => incoming.get(item.id) === 0)
    .sort((left, right) => left.title.localeCompare(right.title));
  const layer = new Map(queue.map(item => [item.id, 0]));
  while (queue.length) {
    const current = queue.shift();
    for (const targetId of outgoing.get(current.id) || []) {
      layer.set(targetId, Math.max(layer.get(targetId) || 0, (layer.get(current.id) || 0) + 1));
      incoming.set(targetId, incoming.get(targetId) - 1);
      if (incoming.get(targetId) === 0) queue.push(items.find(item => item.id === targetId));
    }
  }
  const rows = new Map();
  return Object.fromEntries(items
    .slice()
    .sort((left, right) => (
      (layer.get(left.id) || 0) - (layer.get(right.id) || 0)
      || left.title.localeCompare(right.title)
    ))
    .map(item => {
      const column = layer.get(item.id) || 0;
      const row = rows.get(column) || 0;
      rows.set(column, row + 1);
      return [item.id, { x: 72 + column * 312, y: 72 + row * 168 }];
    }));
}

export function projectScope({
  scopeId = null,
  items = [],
  flowLinks = [],
  references = [],
  consequences = [],
  notes = [],
  positions = {},
} = {}) {
  const byId = new Map(items.map(item => [item.id, item]));
  const children = items
    .filter(item => item.parentId === scopeId)
    .sort((left, right) => left.title.localeCompare(right.title));
  const projectedFlows = [];
  for (const flow of flowLinks) {
    const source = directChildFor(flow.sourceId, scopeId, byId);
    const target = directChildFor(flow.targetId, scopeId, byId);
    if (!source || !target || source.id === target.id) continue;
    projectedFlows.push({
      ...flow,
      sourceId: source.id,
      targetId: target.id,
      rolledUp: source.id !== flow.sourceId || target.id !== flow.targetId,
    });
  }
  const arranged = arrange(children, projectedFlows);
  const saved = normalizePositions(positions);
  const noteCount = new Map();
  for (const note of notes) {
    for (const itemId of note.anchorIds || []) {
      noteCount.set(itemId, (noteCount.get(itemId) || 0) + 1);
    }
  }
  const referenceCount = new Map();
  for (const reference of references) {
    referenceCount.set(reference.itemId, (referenceCount.get(reference.itemId) || 0) + 1);
  }
  const consequenceCount = new Map();
  for (const consequence of consequences) {
    if (consequence.anchor?.scope === 'item') {
      consequenceCount.set(
        consequence.anchor.itemId,
        (consequenceCount.get(consequence.anchor.itemId) || 0) + 1,
      );
    }
  }
  const childCount = new Map();
  for (const item of items) {
    if (item.parentId) childCount.set(item.parentId, (childCount.get(item.parentId) || 0) + 1);
  }
  const nodes = children.map(item => ({
    item,
    position: saved[item.id] || arranged[item.id],
    noteCount: noteCount.get(item.id) || 0,
    referenceCount: referenceCount.get(item.id) || 0,
    consequenceCount: consequenceCount.get(item.id) || 0,
    childCount: childCount.get(item.id) || 0,
  }));
  const width = Math.max(1_200, ...nodes.map(node => node.position.x + 320));
  const height = Math.max(720, ...nodes.map(node => node.position.y + 220));
  return {
    scope: scopeId ? byId.get(scopeId) || null : null,
    nodes,
    flowLinks: projectedFlows,
    width,
    height,
  };
}

export function orthogonalPath(source, target) {
  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const middleX = startX + Math.max(48, (endX - startX) / 2);
  const radius = 12;
  if (Math.abs(endY - startY) < 1) return `M ${startX} ${startY} H ${endX}`;
  const direction = endY > startY ? 1 : -1;
  const beforeTurn = middleX - radius;
  const afterTurn = middleX + radius;
  return [
    `M ${startX} ${startY}`,
    `H ${beforeTurn}`,
    `Q ${middleX} ${startY} ${middleX} ${startY + radius * direction}`,
    `V ${endY - radius * direction}`,
    `Q ${middleX} ${endY} ${afterTurn} ${endY}`,
    `H ${endX}`,
  ].join(' ');
}
