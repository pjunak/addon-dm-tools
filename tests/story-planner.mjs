import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createStoryPlanner } from '../story-planner.js';
import { STORY_PLANNER_STYLES } from '../story-planner-styles.js';
import {
  anchoredZoomScroll,
  canvasPixelRectangle,
  canvasSurfaceSize,
  pannedCanvasScroll,
  rectanglesIntersect,
  requestPlannerFullscreen,
  setPlannerFullscreen,
  setShortcutModalOpen,
} from '../story-planner-interactions.js';
import {
  snapToDevicePixel,
  storyCanvasCardMetrics,
  storyCanvasCssVariables,
  storyCanvasRenderingMetrics,
  storyCanvasTypography,
} from '../story-planner-rendering.js';
import {
  clampCanvasZoom,
  storyCanvasDetailLevel,
} from '../story-planner-zoom.js';
import {
  itemAncestors,
  itemSubtreeIds,
  normalizePositions,
  orthogonalPath,
  flowLabelGeometry,
  projectScope,
} from '../story-planner-model.js';
import {
  flowLabelFirstLineOffset,
  flowLabelLayoutKey,
  flowLabelLayoutWidth,
  layoutFlowLabel,
  layoutStoryNodeText,
  storyNodeTextMetrics,
} from '../story-planner-labels.js';

const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));

class FakeFormData {
  constructor(form) {
    this.fields = form.fields;
  }

  get(name) {
    const value = this.fields[name];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  getAll(name) {
    const value = this.fields[name];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }
}

function interpolate(value, params = {}) {
  return String(value).replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (_match, key) => String(params[key] ?? `{${key}}`),
  );
}

function planningItem(overrides = {}) {
  return {
    id: 'plotline-dragons',
    schemaVersion: 3,
    kind: 'plotline',
    parentId: null,
    title: 'The Waking Dragons',
    summary: 'Ancient dragons stir.',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
    ...overrides,
  };
}

test('scope projection shows only direct children and their local flow', () => {
  const plotline = planningItem();
  const quest = planningItem({
    id: 'quest-earthquake',
    kind: 'quest',
    parentId: plotline.id,
    title: 'Investigate the Earthquake',
  });
  const nested = planningItem({
    id: 'event-cultists',
    kind: 'event',
    eventType: 'encounter',
    parentId: quest.id,
    title: 'Cultist Ambush',
  });
  const decision = planningItem({
    id: 'branch-route',
    kind: 'branch',
    branchType: 'decision',
    parentId: plotline.id,
    title: 'Choose a route',
  });
  const projected = projectScope({
    scopeId: plotline.id,
    items: [plotline, quest, nested, decision],
    flowLinks: [{
      id: 'flow-local',
      sourceId: decision.id,
      targetId: quest.id,
      kind: 'option',
      label: 'Investigate',
    }, {
      id: 'flow-nested',
      sourceId: nested.id,
      targetId: decision.id,
      kind: 'continues',
      label: '',
    }],
    notes: [{
      id: 'note',
      anchorIds: [quest.id],
    }],
  });
  assert.deepEqual(projected.nodes.map(node => node.item.id).sort(), [
    'branch-route',
    'quest-earthquake',
  ]);
  assert.deepEqual(projected.flowLinks.map(flow => flow.id), ['flow-local']);
  assert.equal(Object.hasOwn(projected.flowLinks[0], 'rolledUp'), false);
  assert.equal(projected.nodes.find(node => node.item.id === quest.id).noteCount, 1);
  assert.deepEqual(itemAncestors(nested.id, [plotline, quest, nested]), [
    plotline,
    quest,
    nested,
  ]);
});

test('positions snap to the planner grid and orthogonal paths remain deterministic', () => {
  assert.deepEqual(normalizePositions({
    alpha: { x: 25, y: 71 },
    invalid: { x: Infinity, y: 0 },
  }), {
    alpha: { x: 24, y: 72 },
  });
  assert.equal(
    orthogonalPath(
      { x: 0, y: 0, width: 240, height: 116 },
      { x: 500, y: 180, width: 240, height: 116 },
    ),
    'M 240 58 H 358 Q 370 58 370 70 V 226 Q 370 238 382 238 H 500',
  );
});

test('item subtrees include every nested descendant once', () => {
  const plotline = planningItem();
  const quest = planningItem({ id: 'quest', kind: 'quest', parentId: plotline.id });
  const event = planningItem({
    id: 'event',
    kind: 'event',
    eventType: 'story',
    parentId: quest.id,
  });
  assert.deepEqual(itemSubtreeIds(plotline.id, [plotline, quest, event]), [
    plotline.id,
    quest.id,
    event.id,
  ]);
});

test('Atlas dock owns the desktop rail and becomes horizontal on narrow screens', () => {
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-planner-workbench\{[^}]*grid-template-columns:13\.5rem minmax\(0,1fr\)[^}]*height:max\(42rem,75vh\)/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-stage-canvas-wrap\{[^}]*grid-column:2[^}]*grid-row:2[^}]*min-height:0[^}]*overflow:hidden/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-atlas-tool\[data-kind="quest"\]\{border-color:var\(--color-info\)\}/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-atlas-tool\[data-event-type="encounter"\]\{border-color:var\(--color-danger\)\}/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-atlas-tool\[data-kind="branch"\]\{border-style:dashed;border-color:var\(--accent-gold\)\}/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /@media\(max-width:900px\)\{[\s\S]*?\.dmt-atlas-dock\{[^}]*overflow-x:auto/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-shortcuts-modal\[hidden\]\{display:none!important\}/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-story-node\[data-needs-details="true"\]\{background-image:repeating-linear-gradient/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-planner-dialog-actions\{[^}]*display:flex[^}]*flex:0 0 auto/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.is-fullscreen \.dmt-builder-top-controls\{[^}]*top:0[^}]*transform:translateY\(calc\(-100% \+ 8px\)\)/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.is-fullscreen \.dmt-builder-top-controls::after\{[^}]*bottom:-12px[^}]*height:20px/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.is-fullscreen \.dmt-builder-bottom-controls\{[^}]*bottom:0[^}]*transform:translateY\(calc\(100% - 8px\)\)/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.is-fullscreen \.dmt-builder-bottom-controls::before\{[^}]*top:-12px[^}]*height:20px/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-fullscreen-toggle\{[^}]*top:var\(--space-3\)[^}]*right:var\(--space-3\)/,
  );
});

test('flow labels use the longest straight connector segment and exact host lines', () => {
  const source = { x: 0, y: 0, width: 240, height: 116 };
  const horizontal = { x: 500, y: 0, width: 240, height: 116 };
  assert.deepEqual(flowLabelGeometry(source, horizontal), {
    x: 370,
    y: 58,
    angle: 0,
    maxWidth: 240,
  });

  const vertical = { x: 300, y: 400, width: 240, height: 116 };
  assert.deepEqual(flowLabelGeometry(source, vertical), {
    x: 288,
    y: 258,
    angle: 90,
    maxWidth: 240,
  });
  let receivedOptions = null;
  const label = layoutFlowLabel('Wake the sleeping dragon', source, vertical, (text, options) => {
    assert.equal(text, 'Wake the sleeping dragon');
    receivedOptions = options;
    return { lines: [{ text: 'Wake the' }, { text: 'sleeping dragon' }] };
  });
  assert.equal(receivedOptions.maxWidth, 240);
  assert.deepEqual(label.lines, ['Wake the', 'sleeping dragon']);
  assert.equal(flowLabelFirstLineOffset(label.lines.length), -8);
  assert.equal(flowLabelLayoutWidth(96.24), 96);
  assert.equal(flowLabelLayoutWidth(96.26), 96.5);
  assert.equal(flowLabelLayoutKey('Wake the dragon', 96.24), '["Wake the dragon",96,12,16]');

  let compactOptions = null;
  layoutFlowLabel('Compact label', source, horizontal, (_text, options) => {
    compactOptions = options;
    return { lines: [{ text: 'Compact label' }] };
  }, 0.5);
  assert.equal(compactOptions.font, '20px Inter, "Helvetica Neue", sans-serif');
  assert.equal(compactOptions.lineHeight, 28);

  assert.deepEqual(
    layoutFlowLabel('Fallback label', source, horizontal, () => { throw new Error('old host'); }).lines,
    ['Fallback label'],
  );
});

test('shortcut popup synchronizes hidden, inert, accessibility, and focus state', () => {
  const attributes = new Map([
    ['hidden', ''],
    ['inert', ''],
    ['aria-hidden', 'true'],
  ]);
  let closeFocusCount = 0;
  let triggerFocusCount = 0;
  const modal = {
    toggleAttribute(name, force) {
      if (force) attributes.set(name, '');
      else attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    querySelector() {
      return { focus: () => { closeFocusCount++; } };
    },
  };
  const root = {
    querySelector(selector) {
      if (selector === '[data-dmt-shortcuts-modal]') return modal;
      if (selector === '[data-dmt-command="shortcuts"]') {
        return { focus: () => { triggerFocusCount++; } };
      }
      return null;
    },
  };

  assert.equal(setShortcutModalOpen(root, true), true);
  assert.equal(attributes.has('hidden'), false);
  assert.equal(attributes.has('inert'), false);
  assert.equal(attributes.get('aria-hidden'), 'false');
  assert.equal(closeFocusCount, 1);

  assert.equal(setShortcutModalOpen(root, false), true);
  assert.equal(attributes.has('hidden'), true);
  assert.equal(attributes.has('inert'), true);
  assert.equal(attributes.get('aria-hidden'), 'true');
  assert.equal(triggerFocusCount, 1);
});

test('fullscreen uses one pressed-state control for entry and exit', () => {
  const classes = new Set();
  const attributes = new Map();
  const button = {
    dataset: {
      enterLabel: 'Expand builder to fullscreen',
      exitLabel: 'Exit fullscreen builder',
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  const root = {
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      remove(name) {
        classes.delete(name);
      },
    },
    querySelector(selector) {
      return selector === '[data-dmt-command="fullscreen"]' ? button : null;
    },
  };

  assert.equal(setPlannerFullscreen(root, true), true);
  assert.equal(classes.has('is-fullscreen'), true);
  assert.equal(attributes.get('aria-pressed'), 'true');
  assert.equal(attributes.get('aria-label'), 'Exit fullscreen builder');

  classes.add('is-controls-open');
  assert.equal(setPlannerFullscreen(root, false), true);
  assert.equal(classes.has('is-fullscreen'), false);
  assert.equal(classes.has('is-controls-open'), false);
  assert.equal(attributes.get('aria-pressed'), 'false');
  assert.equal(attributes.get('aria-label'), 'Expand builder to fullscreen');
});

test('fullscreen requests the physical display and exits through the document', async () => {
  let requestCount = 0;
  let exitCount = 0;
  const doc = {
    fullscreenElement: null,
    exitFullscreen() {
      exitCount++;
      this.fullscreenElement = null;
      return Promise.resolve();
    },
  };
  const target = {
    ownerDocument: doc,
    requestFullscreen() {
      requestCount++;
      doc.fullscreenElement = target;
      return Promise.resolve();
    },
  };
  doc.documentElement = target;
  const root = { ownerDocument: doc };

  assert.equal(await requestPlannerFullscreen(root, true), true);
  assert.equal(requestCount, 1);
  assert.equal(doc.fullscreenElement, target);
  assert.equal(await requestPlannerFullscreen(root, false), false);
  assert.equal(exitCount, 1);
  assert.equal(doc.fullscreenElement, null);
});

test('canvas zoom anchors the pointer and derives discrete rendering metrics', () => {
  assert.equal(clampCanvasZoom(0.2), 0.35);
  assert.equal(clampCanvasZoom(1.25), 1.25);
  assert.equal(clampCanvasZoom(4), 2);
  assert.equal(clampCanvasZoom('invalid'), 1);
  assert.equal(storyCanvasDetailLevel(0.35), 'overview');
  assert.equal(storyCanvasDetailLevel(0.449), 'overview');
  assert.equal(storyCanvasDetailLevel(0.45), 'compact');
  assert.equal(storyCanvasDetailLevel(0.599), 'compact');
  assert.equal(storyCanvasDetailLevel(0.6), 'condensed');
  assert.equal(storyCanvasDetailLevel(0.6 - Number.EPSILON), 'condensed');
  assert.equal(storyCanvasDetailLevel(0.75), 'condensed');
  assert.equal(storyCanvasDetailLevel(0.999), 'condensed');
  assert.equal(storyCanvasDetailLevel(1), 'full');
  assert.equal(storyCanvasTypography(0.35).id, 'minimum');
  assert.equal(storyCanvasTypography(0.6).id, 'minimum');
  assert.equal(storyCanvasTypography(0.6 + Number.EPSILON).id, 'minimum');
  assert.equal(storyCanvasTypography(0.601).id, 'small');
  assert.equal(storyCanvasTypography(0.8).id, 'small');
  assert.equal(storyCanvasTypography(0.801).id, 'standard');
  assert.equal(storyCanvasTypography(1).id, 'standard');
  assert.equal(storyCanvasTypography(1.001).id, 'large');
  assert.equal(storyCanvasTypography(1.25).id, 'large');
  assert.equal(storyCanvasTypography(1.251).id, 'larger');
  assert.equal(storyCanvasTypography(1.5).id, 'larger');
  assert.equal(storyCanvasTypography(1.501).id, 'largest');
  assert.equal(storyCanvasTypography(1.75).id, 'largest');
  assert.equal(storyCanvasTypography(1.751).id, 'maximum');
  assert.equal(storyCanvasTypography(2).id, 'maximum');
  for (const zoom of [0.35, 0.6, 0.8, 1, 1.25, 1.5, 1.75, 2]) {
    const typography = storyCanvasTypography(zoom);
    for (const property of [
      'titleFontSize',
      'titleLineHeight',
      'bodyFontSize',
      'bodyLineHeight',
      'edgeFontSize',
      'edgeLineHeight',
      'edgeStrokeWidth',
    ]) assert.equal(Number.isInteger(typography[property]), true);
  }
  assert.equal(storyCanvasRenderingMetrics(0.5).edgeFontSize, 20);
  assert.equal(storyCanvasRenderingMetrics(0.5).edgeLineHeight, 28);
  assert.equal(storyCanvasRenderingMetrics(2).edgeFontSize, 12);
  assert.equal(snapToDevicePixel(0.7), 1);
  assert.equal(snapToDevicePixel(0.7, 2), 0.5);
  assert.deepEqual(storyCanvasCardMetrics(0.35), {
    width: 84,
    minHeight: 41,
    padding: 4,
    borderWidth: 1,
    contentWidth: 74,
    titleMargin: 1,
    headerGap: 3,
    metaGap: 1,
    metaMarginTop: 3,
    badgePaddingBlock: 1,
    badgePaddingInline: 3,
    hairline: 1,
    marginaliaSize: 10,
  });
  assert.equal(storyCanvasCardMetrics(0.35, 2).contentWidth, 75);
  assert.deepEqual(storyCanvasCssVariables(0.6), {
    '--dmt-canvas-zoom': '0.6',
    '--dmt-title-font-size': '15px',
    '--dmt-title-line-height': '18px',
    '--dmt-body-font-size': '10px',
    '--dmt-body-line-height': '14px',
    '--dmt-edge-font-size': `${10 / 0.6}px`,
    '--dmt-edge-stroke-width': `${5 / 0.6}px`,
    '--dmt-node-width': '144px',
    '--dmt-node-min-height': '70px',
    '--dmt-node-padding': '7px',
    '--dmt-node-border': '1px',
    '--dmt-node-title-margin': '2px',
    '--dmt-node-header-gap': '5px',
    '--dmt-node-meta-gap': '2px',
    '--dmt-node-meta-margin': '5px',
    '--dmt-node-badge-padding-block': '1px',
    '--dmt-node-badge-padding-inline': '4px',
    '--dmt-node-hairline': '1px',
    '--dmt-node-marginalia-size': '17px',
  });
  assert.deepEqual(anchoredZoomScroll({
    oldZoom: 1,
    newZoom: 1.5,
    scrollLeft: 100,
    scrollTop: 200,
    pointerX: 50,
    pointerY: 50,
  }), {
    left: 175,
    top: 325,
  });
  assert.deepEqual(anchoredZoomScroll({
    oldZoom: 1,
    newZoom: 1.5,
    scrollLeft: 480,
    scrollTop: 480,
    pointerX: 50,
    pointerY: 50,
    originX: 480,
    originY: 480,
  }), {
    left: 505,
    top: 505,
  });
  assert.deepEqual(canvasPixelRectangle({ x: 72, y: 48, width: 240, height: 116 }, 0.5), {
    x: 36,
    y: 24,
    width: 120,
    height: 58,
  });
});

test('planner node text uses integer bands and delegates width-aware wrapping', () => {
  const overviewMetrics = storyNodeTextMetrics('title', { zoom: 0.35 });
  assert.equal(overviewMetrics.fontSize, 15);
  assert.equal(overviewMetrics.lineHeight, 18);
  assert.equal(overviewMetrics.maxWidth, 74);
  assert.equal(overviewMetrics.typographyBand, 'minimum');
  assert.deepEqual(storyNodeTextMetrics('title', { zoom: 0.5 }), {
    role: 'title',
    fontSize: 15,
    font: '15px Cinzel, Georgia, serif',
    lineHeight: 18,
    letterSpacing: 0,
    maxLines: 2,
    maxWidth: 106,
    typographyBand: 'minimum',
  });
  assert.equal(storyNodeTextMetrics('summary', { zoom: 0.6 }).fontSize, 10);
  assert.equal(storyNodeTextMetrics('summary', { zoom: 0.75 }).fontSize, 11);
  assert.equal(storyNodeTextMetrics('title', { zoom: 1.25 }).fontSize, 24);
  assert.equal(storyNodeTextMetrics('title', {
    zoom: 0.35,
    deviceScaleFactor: 2,
  }).maxWidth, 75);

  const calls = [];
  const layout = layoutStoryNodeText(
    'Follow the silver road before dawn',
    { role: 'title', zoom: 0.5 },
    (text, options) => {
      calls.push({ text, options });
      if (text.endsWith('…')) {
        return text.length <= 12
          ? { lines: [{ text }] }
          : { lines: [{ text: text.slice(0, 8) }, { text: text.slice(8) }] };
      }
      return { lines: [
        { text: 'Follow the' },
        { text: 'silver road' },
        { text: 'before dawn' },
      ] };
    },
  );
  assert.equal(layout.measured, true);
  assert.equal(layout.lines.length, 2);
  assert.match(layout.lines[1], /…$/);
  assert.equal(calls[0].options.maxWidth, 106);
  assert.equal(calls[0].options.font, '15px Cinzel, Georgia, serif');

  const fallback = layoutStoryNodeText(
    'Fallback wrapping',
    { role: 'summary', zoom: 1 },
    () => { throw new Error('older host'); },
  );
  assert.equal(fallback.measured, false);
  assert.deepEqual(fallback.lines, ['Fallback wrapping']);
});

test('canvas working margin keeps a viewport-sized canvas pannable in every direction', () => {
  assert.deepEqual(canvasSurfaceSize({
    baseWidth: 1200,
    baseHeight: 720,
    viewportWidth: 1280,
    viewportHeight: 720,
    zoom: 1,
    panMargin: 480,
  }), {
    width: 2240,
    height: 1680,
  });
});

test('middle-button panning translates pointer travel into viewport scroll', () => {
  assert.deepEqual(pannedCanvasScroll({
    scrollLeft: 500,
    scrollTop: 300,
    startX: 200,
    startY: 180,
    currentX: 140,
    currentY: 230,
  }), {
    left: 560,
    top: 250,
  });
  assert.deepEqual(pannedCanvasScroll({
    scrollLeft: 10,
    scrollTop: 10,
    startX: 0,
    startY: 0,
    currentX: 100,
    currentY: 100,
  }), {
    left: 0,
    top: 0,
  });
});

test('selection rectangles include cards that touch their boundary', () => {
  assert.equal(rectanglesIntersect(
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 100, y: 40, width: 20, height: 20 },
  ), true);
  assert.equal(rectanglesIntersect(
    { x: 0, y: 0, width: 99, height: 100 },
    { x: 100, y: 40, width: 20, height: 20 },
  ), false);
});

function fixture() {
  const stores = Object.fromEntries([
    'planning_items',
    'planning_flow_links',
    'planning_references',
    'planning_consequences',
    'dm_notes',
    'planning_views',
  ].map(name => [name, new Map()]));
  stores.planning_items.set('plotline-dragons', {
    schemaVersion: 3,
    kind: 'plotline',
    parentId: null,
    title: 'The Waking Dragons',
    summary: 'Ancient dragons stir.',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  });
  let sequence = 0;
  const scheduled = [];
  const announcements = [];
  const host = {
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[character])),
      dataAction: () => '',
      dataOn: () => '',
      breadcrumb: values => values.map(value => value.label).join(' / '),
      renderMarkdown: value => String(value),
    },
    action: name => `dm-tools:${name}`,
    i18n: {
      t: (key, params) => interpolate(en[key] ?? key, params),
    },
    role: { isDM: () => true },
    store: {
      generateId(prefix) {
        sequence++;
        return `${String(prefix).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}-${sequence}`;
      },
      collection(name) {
        const values = stores[name];
        if (!values) throw new Error(`unexpected collection ${name}`);
        return {
          list: () => [...values].map(([id, value]) => ({ id, ...structuredClone(value) })),
          get: id => values.has(id) ? { id, ...structuredClone(values.get(id)) } : null,
          async save(record) {
            const value = structuredClone(record);
            delete value.id;
            values.set(record.id, value);
            return record;
          },
          async remove(id) {
            values.delete(id);
          },
        };
      },
      async transaction(names, callback) {
        const allowed = new Set(names);
        return callback({
          collection(name) {
            if (!allowed.has(name)) throw new Error(`unexpected transaction collection ${name}`);
            const values = stores[name];
            return {
              remove: id => values.delete(id),
              put(record) {
                const stored = structuredClone(record);
                delete stored.id;
                values.set(record.id, stored);
                return record;
              },
            };
          },
        });
      },
      getCharacters: () => [{ id: 'mira', name: 'Mira Vel' }],
      getFactions: () => ({}),
      getLocations: () => [],
      getMysteries: () => [],
      getCollection: () => [],
      getEvents: () => [],
    },
    ui: {
      rerender() {},
      announce: message => announcements.push(message),
      toast() {},
    },
  };
  const planner = createStoryPlanner(host, {
    schedule(callback) {
      scheduled.push(callback);
      return scheduled.length - 1;
    },
    cancelSchedule(token) {
      scheduled[token] = null;
    },
  });
  return { planner, stores, announcements, host };
}

function event(fields) {
  return {
    preventDefault() {},
    currentTarget: { fields },
  };
}

test('unified route renders one canvas and manually creates a nested quest', async t => {
  const original = globalThis.FormData;
  globalThis.FormData = FakeFormData;
  t.after(() => { globalThis.FormData = original; });
  const value = fixture();
  const rootHtml = value.planner.render();
  assert.match(rootHtml, /Story Planner/);
  assert.match(rootHtml, /dmt-story-canvas/);
  assert.match(rootHtml, /data-dmt-canvas-surface/);
  assert.match(rootHtml, /data-pan-margin="480"/);
  assert.match(rootHtml, /class="dmt-builder-top-controls"/);
  assert.match(rootHtml, /class="dmt-builder-bottom-controls"/);
  assert.match(rootHtml, /class="dmt-atlas-dock"/);
  assert.match(rootHtml, /class="dmt-story-edges"[^>]*role="group"/);
  assert.match(rootHtml, /class="dmt-story-edges"[^>]*viewBox="0 0 [^"]+"/);
  assert.match(rootHtml, /data-dmt-x="\d+" data-dmt-y="\d+"/);
  assert.doesNotMatch(rootHtml, /transform:scale\(/);
  assert.match(rootHtml, /data-dmt-detail="full"[^>]*style="[^"]*--dmt-title-font-size:20px/);
  assert.match(rootHtml, /data-dmt-detail="full"[^>]*style="[^"]*--dmt-body-font-size:12px/);
  assert.match(rootHtml, /data-dmt-detail="full"[^>]*style="[^"]*--dmt-node-width:240px/);
  assert.doesNotMatch(rootHtml, /--dmt-(?:type-zoom|edge-type-zoom)/);
  assert.equal((rootHtml.match(/data-dmt-create-kind=/g) || []).length, 8);
  assert.match(rootHtml, /data-dmt-shortcuts-modal hidden inert aria-hidden="true"/);
  assert.match(rootHtml, /data-dmt-command="fullscreen"/);
  assert.match(rootHtml, /data-dmt-command="zoom-out"/);
  assert.match(rootHtml, /data-dmt-command="zoom-reset"[^>]*><output data-dmt-zoom-label>100%<\/output>/);
  assert.match(rootHtml, /data-dmt-command="zoom-in"/);
  assert.match(rootHtml, /<dt>Scroll wheel<\/dt><dd>Zoom around the pointer/);
  assert.doesNotMatch(rootHtml, /dm-story-inspector/);
  assert.doesNotMatch(rootHtml, /Planning Graph|Folder|Named sections/);

  const emptyCanvasHtml = value.planner.render(
    'plotline-dragons',
    ['dm-plans', 'plotline-dragons'],
  );
  assert.match(emptyCanvasHtml, /<\/div>\s*<div class="dmt-empty-canvas">/);
  await value.planner.createItem('quest', '', { x: 264, y: 168 });
  const createdId = [...value.stores.planning_items.keys()]
    .find(id => id !== 'plotline-dragons');
  const placedHtml = value.planner.render(
    'plotline-dragons',
    ['dm-plans', 'plotline-dragons'],
  );
  assert.equal(value.planner.getState().draft, null);
  assert.doesNotMatch(placedHtml, /class="dmt-planner-modal"/);
  assert.match(placedHtml, /data-needs-details="true"/);
  assert.match(placedHtml, /Needs details/);
  assert.equal(value.stores.planning_items.get(createdId).title, 'Untitled Quest');
  assert.deepEqual(value.stores.planning_views.get('scope-plotline-dragons').positions[createdId], {
    x: 264,
    y: 168,
  });

  value.planner.editItem(createdId);
  const dialogHtml = value.planner.render(
    'plotline-dragons',
    ['dm-plans', 'plotline-dragons'],
  );
  assert.match(dialogHtml, /dmt-planner-dialog-actions[\s\S]*?>Cancel<\/button>[\s\S]*?type="submit" form="dmt-planner-item-form"/);
  assert.match(dialogHtml, /<form class="dmt-planner-form" id="dmt-planner-item-form"/);
  const draft = value.planner.getState().draft.item;
  await value.planner.saveItem(event({
    id: draft.id,
    kind: 'quest',
    parentId: 'plotline-dragons',
    title: 'Investigate the Earthquake',
    summary: 'Find the source.',
    objective: 'Reach the ruined observatory.',
    body: '',
    setup: '',
    resolution: '',
    tags: 'dragon, mystery',
  }));
  assert.equal(value.stores.planning_items.get(draft.id).parentId, 'plotline-dragons');
  assert.equal(value.stores.planning_items.get(draft.id).kind, 'quest');
  assert.deepEqual(value.stores.planning_items.get(draft.id).tags, ['dragon', 'mystery']);
  assert.match(
    value.planner.render('plotline-dragons', ['dm-plans', 'plotline-dragons']),
    /<article class="dmt-story-node[^"]*"[\s\S]*?data-needs-details="false"/,
  );
});

test('manual flow stays local while named references may cross canvas scopes', async t => {
  const original = globalThis.FormData;
  globalThis.FormData = FakeFormData;
  t.after(() => { globalThis.FormData = original; });
  const value = fixture();
  value.stores.planning_items.set('branch-choice', {
    schemaVersion: 3,
    kind: 'branch',
    branchType: 'decision',
    parentId: null,
    title: 'Choose a route',
    summary: '',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  });
  value.stores.planning_items.set('event-tremor', {
    schemaVersion: 3,
    kind: 'event',
    eventType: 'story',
    parentId: 'plotline-dragons',
    title: 'The earth trembles',
    summary: '',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  });
  value.planner.editItem('branch-choice');
  const rootHtml = value.planner.render();
  const flowTargetOptions = rootHtml.match(
    /<select class="edit-input" name="targetId" required>([\s\S]*?)<\/select>/,
  )?.[1] || '';
  assert.match(flowTargetOptions, /value="plotline-dragons"/);
  assert.doesNotMatch(flowTargetOptions, /value="event-tremor"/);

  await value.planner.saveFlow({
    preventDefault() {},
    currentTarget: {
      fields: {
        targetId: 'plotline-dragons',
        kind: 'option',
        label: 'Wake the dragon',
      },
    },
  }, 'branch-choice');
  const [flow] = value.stores.planning_flow_links.values();
  assert.equal(flow.kind, 'option');
  assert.equal(flow.label, 'Wake the dragon');
  const labelledFlowHtml = value.planner.render();
  assert.match(labelledFlowHtml, /data-dmt-edge-label="[^"]+"/);
  assert.match(labelledFlowHtml, /class="dmt-story-edge-label"[^>]*data-dmt-label="[^"]+"[^>]*>[\s\S]*?<tspan /);

  await value.planner.saveFlow(event({
    targetId: 'branch-choice',
    kind: 'continues',
    label: 'Forces a choice',
  }), 'event-tremor');
  assert.equal(value.stores.planning_flow_links.size, 1);
  assert.match(value.announcements.at(-1), /validation failed/i);

  await value.planner.savePlanningReference(event({
    targetId: 'event-tremor',
    name: 'Foreshadows the tremor',
    relation: 'reveals',
    quantity: '1',
    notes: '',
  }), 'branch-choice');
  const [reference] = value.stores.planning_references.values();
  assert.deepEqual(reference.target, { scope: 'planning', itemId: 'event-tremor' });

  await value.planner.saveConsequence(event({
    anchor: 'item:branch-choice',
    kind: 'world',
    title: 'The city closes its gates',
    body: '',
    target: 'planning:event-tremor',
  }), 'branch-choice');
  const [consequence] = value.stores.planning_consequences.values();
  assert.deepEqual(consequence.target, { scope: 'planning', itemId: 'event-tremor' });
});

test('schema-v2 canvas positions are ignored rather than converted', () => {
  const value = fixture();
  value.stores.planning_views.set('scope-campaign', {
    schemaVersion: 2,
    scopeId: null,
    positions: { 'plotline-dragons': { x: 984, y: 984 } },
    updatedAt: 100,
  });
  const html = value.planner.render();
  assert.match(html, /style="left:72px;top:72px"/);
  assert.doesNotMatch(html, /left:984px|top:984px/);
});

test('moving an item cannot strand an attached flow on another canvas', async t => {
  const original = globalThis.FormData;
  globalThis.FormData = FakeFormData;
  t.after(() => { globalThis.FormData = original; });
  const value = fixture();
  value.stores.planning_items.set('quest-owner', {
    schemaVersion: 3,
    kind: 'quest',
    parentId: null,
    title: 'New Owner',
    summary: '',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  });
  value.stores.planning_items.set('event-prologue', {
    schemaVersion: 3,
    kind: 'event',
    eventType: 'story',
    parentId: null,
    title: 'Prologue',
    summary: '',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  });
  await value.planner.saveFlow(event({
    targetId: 'plotline-dragons',
    kind: 'continues',
    label: '',
  }), 'event-prologue');
  value.planner.editItem('plotline-dragons');
  await value.planner.saveItem(event({
    kind: 'plotline',
    parentId: 'quest-owner',
    title: 'The Waking Dragons',
    summary: 'Ancient dragons stir.',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: '',
  }));
  assert.equal(value.stores.planning_items.get('plotline-dragons').parentId, null);
  assert.match(value.announcements.at(-1), /validation failed/i);
});

test('deleting a populated plotline confirms and removes only its planning subtree', async t => {
  const originalWindow = globalThis.window;
  let confirmed = false;
  let confirmation = '';
  globalThis.window = {
    location: { hash: '' },
    confirm(message) {
      confirmation = message;
      return confirmed;
    },
  };
  t.after(() => { globalThis.window = originalWindow; });
  const value = fixture();
  const add = (store, record) => {
    const stored = structuredClone(record);
    delete stored.id;
    value.stores[store].set(record.id, stored);
  };
  add('planning_items', planningItem({
    id: 'quest-child',
    kind: 'quest',
    parentId: 'plotline-dragons',
    title: 'Nested quest',
  }));
  add('planning_items', planningItem({
    id: 'event-grandchild',
    kind: 'event',
    eventType: 'story',
    parentId: 'quest-child',
    title: 'Nested event',
  }));
  add('planning_items', planningItem({
    id: 'plotline-survivor',
    title: 'Unrelated plotline',
  }));
  add('planning_flow_links', {
    id: 'flow-out',
    schemaVersion: 3,
    sourceId: 'plotline-dragons',
    targetId: 'plotline-survivor',
    kind: 'continues',
    label: '',
    updatedAt: 100,
  });
  add('planning_references', {
    id: 'reference-out',
    schemaVersion: 3,
    itemId: 'plotline-survivor',
    name: 'Points into deleted plan',
    relation: 'related',
    target: { scope: 'planning', itemId: 'event-grandchild' },
    quantity: 1,
    notes: '',
    updatedAt: 100,
  });
  add('planning_consequences', {
    id: 'consequence-out',
    schemaVersion: 3,
    anchor: { scope: 'item', itemId: 'plotline-survivor' },
    kind: 'world',
    title: 'Points into deleted plan',
    body: '',
    target: { scope: 'planning', itemId: 'quest-child' },
    updatedAt: 100,
  });
  add('dm_notes', {
    id: 'shared-note',
    schemaVersion: 3,
    title: 'Shared note',
    body: '',
    anchorIds: ['event-grandchild', 'plotline-survivor'],
    updatedAt: 100,
  });
  add('planning_views', {
    id: 'scope-plotline-dragons',
    schemaVersion: 3,
    scopeId: 'plotline-dragons',
    positions: { 'quest-child': { x: 72, y: 72 } },
    updatedAt: 100,
  });
  add('planning_views', {
    id: 'scope-campaign',
    schemaVersion: 3,
    scopeId: null,
    positions: {
      'plotline-dragons': { x: 72, y: 72 },
      'plotline-survivor': { x: 384, y: 72 },
    },
    updatedAt: 100,
  });

  await value.planner.deleteItem('plotline-dragons');
  assert.match(confirmation, /nested planning items \(2\)/);
  assert.equal(value.stores.planning_items.has('plotline-dragons'), true);

  confirmed = true;
  await value.planner.deleteItem('plotline-dragons');
  assert.deepEqual([...value.stores.planning_items.keys()], ['plotline-survivor']);
  assert.equal(value.stores.planning_flow_links.size, 0);
  assert.equal(value.stores.planning_references.size, 0);
  assert.equal(value.stores.planning_consequences.size, 0);
  assert.deepEqual(value.stores.dm_notes.get('shared-note').anchorIds, ['plotline-survivor']);
  assert.equal(value.stores.planning_views.has('scope-plotline-dragons'), false);
  assert.deepEqual(value.stores.planning_views.get('scope-campaign').positions, {
    'plotline-survivor': { x: 384, y: 72 },
  });

  await value.planner.undoLastDelete();
  assert.equal(value.stores.planning_items.has('plotline-dragons'), true);
  assert.equal(value.stores.planning_items.has('quest-child'), true);
  assert.equal(value.stores.planning_items.has('event-grandchild'), true);
  assert.equal(value.stores.planning_flow_links.has('flow-out'), true);
  assert.equal(value.stores.planning_references.has('reference-out'), true);
  assert.equal(value.stores.planning_consequences.has('consequence-out'), true);
  assert.deepEqual(value.stores.dm_notes.get('shared-note').anchorIds, [
    'event-grandchild',
    'plotline-survivor',
  ]);
  assert.equal(value.stores.planning_views.has('scope-plotline-dragons'), true);
  assert.deepEqual(value.stores.planning_views.get('scope-campaign').positions, {
    'plotline-dragons': { x: 72, y: 72 },
    'plotline-survivor': { x: 384, y: 72 },
  });
});
