import { flowLabelGeometry, orthogonalPath } from './story-planner-model.js';
import {
  flowLabelFirstLineOffset,
  flowLabelLayoutKey,
  flowLabelTextMetrics,
  layoutFlowLabelLines,
  layoutStoryNodeText,
} from './story-planner-labels.js';
import {
  snapToDevicePixel,
  storyCanvasCssVariables,
} from './story-planner-rendering.js';
import {
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  NATIVE_CANVAS_ZOOM,
  clampCanvasZoom,
  normalizeCanvasZoom,
  stepCanvasZoom,
  storyCanvasDetailLevel,
} from './story-planner-zoom.js';

const GRID = 24;
const DRAG_THRESHOLD = 4;
const WHEEL_ZOOM_DELTA_PER_STEP = 100;

export function anchoredZoomScroll({
  oldZoom,
  newZoom,
  scrollLeft,
  scrollTop,
  pointerX,
  pointerY,
  originX = 0,
  originY = 0,
}) {
  const from = clampCanvasZoom(oldZoom);
  const to = clampCanvasZoom(newZoom);
  return {
    left: Math.max(0, originX + ((scrollLeft + pointerX - originX) / from) * to - pointerX),
    top: Math.max(0, originY + ((scrollTop + pointerY - originY) / from) * to - pointerY),
  };
}

export function canvasSurfaceSize({
  baseWidth,
  baseHeight,
  viewportWidth,
  viewportHeight,
  zoom,
  panMargin,
}) {
  const scale = clampCanvasZoom(zoom);
  const margin = Math.max(0, Number(panMargin) || 0);
  return {
    width: Math.max(Number(baseWidth) * scale, Number(viewportWidth)) + margin * 2,
    height: Math.max(Number(baseHeight) * scale, Number(viewportHeight)) + margin * 2,
  };
}

export function pannedCanvasScroll({
  scrollLeft,
  scrollTop,
  startX,
  startY,
  currentX,
  currentY,
}) {
  return {
    left: Math.max(0, scrollLeft - (currentX - startX)),
    top: Math.max(0, scrollTop - (currentY - startY)),
  };
}

function canvasZoom(canvas) {
  return normalizeCanvasZoom(canvas?.dataset.dmtZoom);
}

function normalizedWheelDelta(event) {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return 0;
  if (event.deltaMode !== 0) return Math.sign(event.deltaY) * WHEEL_ZOOM_DELTA_PER_STEP;
  return Math.sign(event.deltaY) * Math.min(
    Math.abs(event.deltaY),
    WHEEL_ZOOM_DELTA_PER_STEP,
  );
}

function renderingScaleFactor(element) {
  const factor = Number(element?.ownerDocument?.defaultView?.devicePixelRatio);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function applyCanvasCssVariables(canvas, zoom) {
  const scaleFactor = renderingScaleFactor(canvas);
  for (const [property, value] of Object.entries(
    storyCanvasCssVariables(zoom, scaleFactor),
  )) {
    canvas.style.setProperty(property, value);
  }
  return scaleFactor;
}

export function canvasPixelRectangle(rectangle, zoom) {
  const scale = clampCanvasZoom(zoom);
  return {
    x: Number(rectangle?.x || 0) * scale,
    y: Number(rectangle?.y || 0) * scale,
    width: Number(rectangle?.width || 0) * scale,
    height: Number(rectangle?.height || 0) * scale,
  };
}

function pointInCanvas(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  const zoom = canvasZoom(canvas);
  return {
    x: (event.clientX - bounds.left) / zoom,
    y: (event.clientY - bounds.top) / zoom,
  };
}

function nodeGeometry(node) {
  const zoom = canvasZoom(node?.closest?.('.dmt-story-canvas'));
  const bounds = node.getBoundingClientRect();
  return {
    x: Number(node.dataset.dmtX) || 0,
    y: Number(node.dataset.dmtY) || 0,
    width: bounds.width / zoom,
    height: bounds.height / zoom,
  };
}

function setNodePosition(node, x, y, zoom = canvasZoom(node?.closest?.('.dmt-story-canvas'))) {
  const logicalX = Math.max(0, Number(x) || 0);
  const logicalY = Math.max(0, Number(y) || 0);
  const scaleFactor = renderingScaleFactor(node);
  node.dataset.dmtX = String(logicalX);
  node.dataset.dmtY = String(logicalY);
  node.style.left = `${snapToDevicePixel(logicalX * zoom, scaleFactor)}px`;
  node.style.top = `${snapToDevicePixel(logicalY * zoom, scaleFactor)}px`;
}

export function rectanglesIntersect(left, right) {
  return left.x <= right.x + right.width
    && left.x + left.width >= right.x
    && left.y <= right.y + right.height
    && left.y + left.height >= right.y;
}

function selectionRectangle(start, current) {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

function applyRectangle(element, rectangle) {
  const pixels = canvasPixelRectangle(
    rectangle,
    canvasZoom(element?.closest?.('.dmt-story-canvas')),
  );
  element.style.left = `${pixels.x}px`;
  element.style.top = `${pixels.y}px`;
  element.style.width = `${pixels.width}px`;
  element.style.height = `${pixels.height}px`;
}

function syncNodeTextLayouts(canvas, layoutText, zoom, { force = false } = {}) {
  const deviceScaleFactor = renderingScaleFactor(canvas);
  for (const element of canvas.querySelectorAll('[data-dmt-text-role][data-dmt-text]')) {
    const layout = layoutStoryNodeText(
      element.dataset.dmtText,
      {
        role: element.dataset.dmtTextRole,
        zoom,
        deviceScaleFactor,
      },
      layoutText,
    );
    if (!force
        && element.dataset.dmtLayoutKey === layout.key
        && element.dataset.dmtLayoutMeasured === String(layout.measured)) continue;
    if (layout.measured) {
      const lines = layout.lines.map(line => {
        const span = element.ownerDocument.createElement('span');
        span.className = 'dmt-node-text-line';
        span.textContent = line;
        return span;
      });
      element.replaceChildren(...lines);
    } else {
      element.textContent = layout.lines[0] || '';
    }
    element.dataset.dmtLayoutKey = layout.key;
    element.dataset.dmtLayoutMeasured = String(layout.measured);
  }
}

function redraw(canvas, layoutText, { forceTextLayout = false } = {}) {
  const zoom = canvasZoom(canvas);
  for (const edge of canvas.querySelectorAll('[data-dmt-edge]')) {
    const source = canvas.querySelector(`[data-dmt-node="${CSS.escape(edge.dataset.source)}"]`);
    const target = canvas.querySelector(`[data-dmt-node="${CSS.escape(edge.dataset.target)}"]`);
    if (!source || !target) continue;
    const sourceBox = nodeGeometry(source);
    const targetBox = nodeGeometry(target);
    const path = orthogonalPath(sourceBox, targetBox);
    edge.setAttribute('d', path);
    canvas.querySelector(`[data-dmt-edge-hit="${CSS.escape(edge.dataset.dmtEdge)}"]`)
      ?.setAttribute('d', path);
    const label = canvas.querySelector(
      `[data-dmt-edge-label="${CSS.escape(edge.dataset.dmtEdge)}"]`,
    );
    if (label) {
      const geometry = flowLabelGeometry(sourceBox, targetBox);
      label.setAttribute(
        'transform',
        `translate(${geometry.x} ${geometry.y}) rotate(${geometry.angle})`,
      );
      const layoutKey = flowLabelLayoutKey(label.dataset.dmtLabel, geometry.maxWidth, zoom);
      if (forceTextLayout || layoutKey !== label.dataset.dmtLayoutKey) {
        const lines = layoutFlowLabelLines(
          label.dataset.dmtLabel,
          geometry.maxWidth,
          layoutText,
          zoom,
        );
        const metrics = flowLabelTextMetrics(zoom);
        const lineElements = lines.map((line, index) => {
          const span = label.ownerDocument.createElementNS(
            'http://www.w3.org/2000/svg',
            'tspan',
          );
          span.setAttribute('x', '0');
          span.setAttribute('dy', String(
            index ? metrics.lineHeight : flowLabelFirstLineOffset(lines.length, zoom),
          ));
          span.textContent = line;
          return span;
        });
        label.replaceChildren(...lineElements);
        label.dataset.dmtLayoutKey = layoutKey;
      }
    }
  }
}

function isTypingTarget(target) {
  return !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

function trapModalTab(event, modal) {
  if (event.key !== 'Tab' || !modal) return false;
  const controls = [...modal.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(control => !control.closest('[hidden]'));
  if (!controls.length) return false;
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) last.focus();
  else if (!event.shiftKey && document.activeElement === last) first.focus();
  else return false;
  event.preventDefault();
  return true;
}

export function setShortcutModalOpen(root, open) {
  const modal = root?.querySelector('[data-dmt-shortcuts-modal]');
  if (!modal) return false;
  modal.toggleAttribute('hidden', !open);
  modal.toggleAttribute('inert', !open);
  modal.setAttribute('aria-hidden', String(!open));
  if (open) {
    modal.querySelector('[data-dmt-shortcuts-close]:not([tabindex="-1"])')?.focus();
  } else {
    root.querySelector('[data-dmt-command="shortcuts"]')?.focus();
  }
  return true;
}

export function setPlannerFullscreen(root, open) {
  if (!root) return false;
  root.classList.toggle('is-fullscreen', open);
  root.classList.remove('is-controls-open');
  const button = root.querySelector('[data-dmt-command="fullscreen"]');
  if (button) {
    button.setAttribute('aria-pressed', String(open));
    button.setAttribute('aria-label', open ? button.dataset.exitLabel : button.dataset.enterLabel);
    button.setAttribute('title', open ? button.dataset.exitLabel : button.dataset.enterLabel);
  }
  return true;
}

function fullscreenElement(doc) {
  return doc?.fullscreenElement || doc?.webkitFullscreenElement || null;
}

export async function requestPlannerFullscreen(root, open) {
  if (!root) return false;
  const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const target = doc?.documentElement || root;
  try {
    if (open) {
      if (fullscreenElement(doc) === target) return true;
      const request = target.requestFullscreen || target.webkitRequestFullscreen;
      if (typeof request !== 'function') return true;
      await request.call(target);
      return fullscreenElement(doc) === target;
    }
    const active = fullscreenElement(doc);
    if (active) {
      const exit = doc?.exitFullscreen || doc?.webkitExitFullscreen;
      if (typeof exit === 'function') await exit.call(doc);
    }
    return false;
  } catch {
    return false;
  }
}

export function mountPlannerDialog({ root, onDialogTab, onCancelEdit }) {
  if (!root?.querySelector('[data-dmt-modal]')) return () => {};
  const click = event => {
    const tab = event.target.closest('[data-dmt-dialog-tab]');
    if (tab && !tab.disabled) {
      root.querySelectorAll('[data-dmt-dialog-tab]').forEach(button => {
        button.setAttribute('aria-selected', String(button === tab));
      });
      root.querySelectorAll('[data-dmt-dialog-panel]').forEach(panel => {
        panel.toggleAttribute('hidden', panel.dataset.dmtDialogPanel !== tab.dataset.dmtDialogTab);
      });
      onDialogTab?.(tab.dataset.dmtDialogTab);
      return;
    }
    if (event.target.closest('[data-dmt-modal-close]')) onCancelEdit?.();
  };
  const keydown = event => {
    if (trapModalTab(event, root.querySelector('[data-dmt-modal]'))) return;
    if (event.key !== 'Escape') return;
    onCancelEdit?.();
    event.preventDefault();
  };
  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  (root.querySelector('[data-dmt-modal] input[name="title"]')
    || root.querySelector('[data-dmt-modal] button:not([tabindex="-1"])'))
    ?.focus({ preventScroll: true });
  return () => {
    root.removeEventListener('click', click);
    root.removeEventListener('keydown', keydown);
  };
}

export function mountStoryCanvas({
  root,
  selectedItemIds = [],
  selectedFlowIds = [],
  onSelectionChange,
  onEdit,
  onOpen,
  onMove,
  onConnect,
  onConnectStart,
  onCreate,
  onDeleteSelection,
  onUndo,
  onDialogTab,
  onCancelEdit,
  layoutText,
  onTextLayoutInvalidated,
  onZoom,
  onFullscreen,
}) {
  const canvas = root?.querySelector('.dmt-story-canvas');
  const viewport = root?.querySelector('.dmt-story-viewport');
  if (!canvas || !viewport) return () => {};
  const removers = [];
  const items = new Set(selectedItemIds);
  const flows = new Set(selectedFlowIds);
  let primaryId = [...items][0] || '';
  let connectionSource = '';
  let nodeDrag = null;
  let marquee = null;
  let portDrag = null;
  let canvasPan = null;
  let suppressPortClick = false;
  let draggedTool = null;
  let activeScaleFactor = renderingScaleFactor(canvas);
  let accumulatedWheelDelta = 0;

  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  if (typeof onTextLayoutInvalidated === 'function') {
    const unsubscribe = onTextLayoutInvalidated(() => {
      syncNodeTextLayouts(canvas, layoutText, canvasZoom(canvas), { force: true });
      redraw(canvas, layoutText, { forceTextLayout: true });
    });
    if (typeof unsubscribe === 'function') removers.push(unsubscribe);
  }

  const nodeFor = id => canvas.querySelector(`[data-dmt-node="${CSS.escape(id)}"]`);
  const selectionHull = canvas.querySelector('[data-dmt-selection-hull]');
  const marqueeElement = canvas.querySelector('[data-dmt-marquee]');
  const surface = canvas.closest('[data-dmt-canvas-surface]');
  const panMargin = Math.max(0, Number(surface?.dataset.panMargin) || 0);
  const ownerDocument = root.ownerDocument || (typeof document !== 'undefined' ? document : null);

  function nativeFullscreenActive() {
    return fullscreenElement(ownerDocument) === ownerDocument?.documentElement;
  }

  function syncFullscreenState(open) {
    setPlannerFullscreen(root, open);
    syncCanvasViewportSize();
    onFullscreen?.(open);
  }

  async function changeFullscreen(open) {
    const active = await requestPlannerFullscreen(root, open);
    syncFullscreenState(active);
  }

  function syncCanvasViewportSize(zoom = canvasZoom(canvas)) {
    const baseWidth = Math.max(0, Number(surface?.dataset.baseWidth) || 0);
    const baseHeight = Math.max(0, Number(surface?.dataset.baseHeight) || 0);
    const minimumWidth = Math.max(0, viewport.clientWidth);
    const minimumHeight = Math.max(0, viewport.clientHeight);
    canvas.style.width = `${baseWidth * zoom}px`;
    canvas.style.height = `${baseHeight * zoom}px`;
    canvas.style.minWidth = `${minimumWidth}px`;
    canvas.style.minHeight = `${minimumHeight}px`;
    const edges = canvas.querySelector('.dmt-story-edges');
    edges?.setAttribute('width', String(baseWidth * zoom));
    edges?.setAttribute('height', String(baseHeight * zoom));
    if (!surface) return;
    const size = canvasSurfaceSize({
      baseWidth: surface.dataset.baseWidth,
      baseHeight: surface.dataset.baseHeight,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      zoom,
      panMargin,
    });
    surface.style.width = `${size.width}px`;
    surface.style.height = `${size.height}px`;
  }

  function syncZoomControls(zoom) {
    root.querySelectorAll('[data-dmt-zoom-label]').forEach(label => {
      label.textContent = `${Math.round(zoom * 100)}%`;
    });
    root.querySelectorAll('[data-dmt-command="zoom-out"]').forEach(button => {
      button.disabled = zoom <= MIN_CANVAS_ZOOM;
    });
    root.querySelectorAll('[data-dmt-command="zoom-in"]').forEach(button => {
      button.disabled = zoom >= MAX_CANVAS_ZOOM;
    });
  }

  function applyZoom(nextZoom, client = null) {
    const previous = canvasZoom(canvas);
    const next = normalizeCanvasZoom(nextZoom);
    if (Math.abs(previous - next) < 0.001) return previous;
    const bounds = viewport.getBoundingClientRect();
    const pointerX = client ? client.x - bounds.left : viewport.clientWidth / 2;
    const pointerY = client ? client.y - bounds.top : viewport.clientHeight / 2;
    const scroll = anchoredZoomScroll({
      oldZoom: previous,
      newZoom: next,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      pointerX,
      pointerY,
      originX: panMargin,
      originY: panMargin,
    });
    canvas.dataset.dmtZoom = String(next);
    canvas.dataset.dmtDetail = storyCanvasDetailLevel(next);
    activeScaleFactor = applyCanvasCssVariables(canvas, next);
    for (const node of canvas.querySelectorAll('[data-dmt-node]')) {
      setNodePosition(node, node.dataset.dmtX, node.dataset.dmtY, next);
    }
    syncCanvasViewportSize(next);
    syncNodeTextLayouts(canvas, layoutText, next);
    redraw(canvas, layoutText);
    updateHull();
    viewport.scrollLeft = scroll.left;
    viewport.scrollTop = scroll.top;
    syncZoomControls(next);
    onZoom?.(next);
    return next;
  }

  function updateHull() {
    const selectedNodes = [...items].map(nodeFor).filter(Boolean);
    if (selectedNodes.length < 2 || !selectionHull) {
      selectionHull?.setAttribute('hidden', '');
      return;
    }
    const geometries = selectedNodes.map(nodeGeometry);
    const left = Math.min(...geometries.map(value => value.x));
    const top = Math.min(...geometries.map(value => value.y));
    const right = Math.max(...geometries.map(value => value.x + value.width));
    const bottom = Math.max(...geometries.map(value => value.y + value.height));
    applyRectangle(selectionHull, {
      x: left - 8,
      y: top - 8,
      width: right - left + 16,
      height: bottom - top + 16,
    });
    selectionHull.removeAttribute('hidden');
  }

  function syncSelection({ announce = true } = {}) {
    for (const node of canvas.querySelectorAll('[data-dmt-node]')) {
      node.classList.toggle('is-selected', items.has(node.dataset.dmtNode));
      node.setAttribute('aria-pressed', String(items.has(node.dataset.dmtNode)));
    }
    for (const group of canvas.querySelectorAll('[data-dmt-edge-group]')) {
      group.classList.toggle('is-selected', flows.has(group.dataset.dmtEdgeGroup));
    }
    updateHull();
    onSelectionChange?.({
      itemIds: [...items],
      flowIds: [...flows],
      primaryId,
      announce,
    });
  }

  function selectOnlyItem(id, announce = true) {
    items.clear();
    flows.clear();
    if (id) items.add(id);
    primaryId = id;
    syncSelection({ announce });
  }

  function toggleItem(id) {
    flows.clear();
    if (items.has(id)) items.delete(id);
    else items.add(id);
    primaryId = items.has(id) ? id : ([...items].at(-1) || '');
    syncSelection();
  }

  function selectEdge(id, additive) {
    if (!additive) {
      items.clear();
      flows.clear();
    }
    if (additive && flows.has(id)) flows.delete(id);
    else flows.add(id);
    primaryId = '';
    syncSelection();
  }

  function cancelConnection() {
    connectionSource = '';
    portDrag = null;
    canvas.classList.remove('is-connecting');
    canvas.querySelector('[data-dmt-preview]')?.setAttribute('hidden', '');
    onConnectStart?.('');
  }

  function startConnection(id) {
    connectionSource = connectionSource === id ? '' : id;
    canvas.classList.toggle('is-connecting', !!connectionSource);
    onConnectStart?.(connectionSource);
  }

  function visibleCenter() {
    const zoom = canvasZoom(canvas);
    return {
      x: Math.max(0, (viewport.scrollLeft + (viewport.clientWidth / 2) - panMargin) / zoom - 120),
      y: Math.max(0, (viewport.scrollTop + (viewport.clientHeight / 2) - panMargin) / zoom - 58),
    };
  }

  function finishNodeDrag(event) {
    if (!nodeDrag) return;
    const drag = nodeDrag;
    nodeDrag = null;
    if (!drag.moved) {
      if (drag.collapseOnClick) selectOnlyItem(drag.primaryId);
      return;
    }
    const primary = nodeFor(drag.primaryId);
    const current = nodeGeometry(primary);
    const snappedX = Math.max(0, Math.round(current.x / GRID) * GRID);
    const snappedY = Math.max(0, Math.round(current.y / GRID) * GRID);
    const snapDx = snappedX - current.x;
    const snapDy = snappedY - current.y;
    const updates = {};
    for (const id of drag.ids) {
      const node = nodeFor(id);
      if (!node) continue;
      const geometry = nodeGeometry(node);
      const x = Math.max(0, geometry.x + snapDx);
      const y = Math.max(0, geometry.y + snapDy);
      setNodePosition(node, x, y);
      updates[id] = { x, y };
    }
    redraw(canvas, layoutText);
    updateHull();
    onMove?.(updates);
    event.preventDefault();
  }

  listen(root, 'click', event => {
    const tool = event.target.closest('[data-dmt-create-kind]');
    if (tool) {
      onCreate?.(tool.dataset.dmtCreateKind, tool.dataset.dmtCreateSubtype || '', visibleCenter());
      return;
    }
    const command = event.target.closest('[data-dmt-command]')?.dataset.dmtCommand;
    if (command) {
      if (command === 'edit' && items.size === 1 && !flows.size) onEdit?.([...items][0]);
      if (command === 'open' && items.size === 1 && !flows.size) onOpen?.([...items][0]);
      if (command === 'connect' && items.size === 1 && !flows.size) startConnection([...items][0]);
      if (command === 'delete') onDeleteSelection?.([...items], [...flows]);
      if (command === 'undo') onUndo?.();
      if (command === 'shortcuts') setShortcutModalOpen(root, true);
      if (command === 'zoom-in') {
        accumulatedWheelDelta = 0;
        applyZoom(stepCanvasZoom(canvasZoom(canvas), 1));
      }
      if (command === 'zoom-out') {
        accumulatedWheelDelta = 0;
        applyZoom(stepCanvasZoom(canvasZoom(canvas), -1));
      }
      if (command === 'zoom-reset') {
        accumulatedWheelDelta = 0;
        applyZoom(NATIVE_CANVAS_ZOOM);
      }
      if (command === 'fullscreen') {
        const open = !root.classList.contains('is-fullscreen');
        void changeFullscreen(open);
      }
      return;
    }
    if (event.target.closest('[data-dmt-shortcuts-close]')) {
      setShortcutModalOpen(root, false);
      return;
    }
    const tab = event.target.closest('[data-dmt-dialog-tab]');
    if (tab && !tab.disabled) {
      root.querySelectorAll('[data-dmt-dialog-tab]').forEach(button => {
        button.setAttribute('aria-selected', String(button === tab));
      });
      root.querySelectorAll('[data-dmt-dialog-panel]').forEach(panel => {
        panel.toggleAttribute('hidden', panel.dataset.dmtDialogPanel !== tab.dataset.dmtDialogTab);
      });
      onDialogTab?.(tab.dataset.dmtDialogTab);
      return;
    }
    if (event.target.closest('[data-dmt-modal-close]')) {
      onCancelEdit?.();
      return;
    }
    const port = event.target.closest('.dmt-node-port');
    if (port) {
      event.preventDefault();
      event.stopPropagation();
      if (suppressPortClick) suppressPortClick = false;
      else startConnection(port.closest('[data-dmt-node]').dataset.dmtNode);
      return;
    }
    const edge = event.target.closest('[data-dmt-edge-hit]');
    if (edge) {
      selectEdge(edge.dataset.dmtEdgeHit, event.shiftKey);
      return;
    }
    const node = event.target.closest('[data-dmt-node]');
    if (!node || event.target.closest('button, a, input, textarea, select')) return;
    const id = node.dataset.dmtNode;
    if (connectionSource) {
      if (connectionSource !== id) {
        const source = connectionSource;
        cancelConnection();
        onConnect?.(source, id);
      }
    }
  });

  listen(root, 'dblclick', event => {
    const node = event.target.closest('[data-dmt-node]');
    if (!node || event.target.closest('button, a, input, textarea, select')) return;
    event.preventDefault();
    onEdit?.(node.dataset.dmtNode);
  });

  listen(canvas, 'pointerdown', event => {
    if (event.button === 1) {
      canvasPan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
      viewport.classList.add('is-panning');
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    const port = event.target.closest('.dmt-node-port');
    if (port) {
      event.stopPropagation();
      const node = port.closest('[data-dmt-node]');
      const id = node.dataset.dmtNode;
      const wasActive = connectionSource === id;
      connectionSource = id;
      canvas.classList.add('is-connecting');
      portDrag = { id, startClient: { x: event.clientX, y: event.clientY }, moved: false, wasActive };
      const preview = canvas.querySelector('[data-dmt-preview]');
      preview?.removeAttribute('hidden');
      port.setPointerCapture?.(event.pointerId);
      onConnectStart?.(id);
      return;
    }
    const node = event.target.closest('[data-dmt-node]');
    if (node && !event.target.closest('button, a, input, textarea, select')) {
      if (connectionSource) return;
      const id = node.dataset.dmtNode;
      if (event.shiftKey) {
        toggleItem(id);
        if (!items.has(id)) return;
      } else if (!items.has(id)) {
        selectOnlyItem(id);
      }
      primaryId = id;
      const start = pointInCanvas(event, canvas);
      const ids = [...items];
      nodeDrag = {
        start,
        primaryId: id,
        ids,
        positions: new Map(ids.map(itemId => [itemId, nodeGeometry(nodeFor(itemId))])),
        moved: false,
        collapseOnClick: !event.shiftKey && (items.size > 1 || flows.size > 0),
      };
      node.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.target.closest('[data-dmt-edge-hit]')) return;
    canvas.focus({ preventScroll: true });
    const start = pointInCanvas(event, canvas);
    marquee = {
      start,
      additive: event.shiftKey,
      initial: new Set(event.shiftKey ? items : []),
      moved: false,
    };
    if (!event.shiftKey) {
      items.clear();
      flows.clear();
      primaryId = '';
      syncSelection({ announce: false });
    }
    canvas.setPointerCapture?.(event.pointerId);
  });

  listen(canvas, 'pointermove', event => {
    if (canvasPan) {
      const scroll = pannedCanvasScroll({
        ...canvasPan,
        currentX: event.clientX,
        currentY: event.clientY,
      });
      viewport.scrollLeft = scroll.left;
      viewport.scrollTop = scroll.top;
      event.preventDefault();
      return;
    }
    if (portDrag) {
      const distance = Math.abs(event.clientX - portDrag.startClient.x)
        + Math.abs(event.clientY - portDrag.startClient.y);
      if (distance > DRAG_THRESHOLD) portDrag.moved = true;
      const source = nodeGeometry(nodeFor(portDrag.id));
      const target = pointInCanvas(event, canvas);
      canvas.querySelector('[data-dmt-preview]')?.setAttribute('d', orthogonalPath(source, {
        x: target.x,
        y: target.y,
        width: 0,
        height: 0,
      }));
      return;
    }
    if (nodeDrag) {
      const current = pointInCanvas(event, canvas);
      const startGeometries = [...nodeDrag.positions.values()];
      const minimumX = Math.min(...startGeometries.map(value => value.x));
      const minimumY = Math.min(...startGeometries.map(value => value.y));
      const dx = Math.max(current.x - nodeDrag.start.x, -minimumX);
      const dy = Math.max(current.y - nodeDrag.start.y, -minimumY);
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) nodeDrag.moved = true;
      if (!nodeDrag.moved) return;
      for (const id of nodeDrag.ids) {
        const node = nodeFor(id);
        const start = nodeDrag.positions.get(id);
        if (!node || !start) continue;
        setNodePosition(node, start.x + dx, start.y + dy);
      }
      redraw(canvas, layoutText);
      updateHull();
      event.preventDefault();
      return;
    }
    if (!marquee) return;
    const current = pointInCanvas(event, canvas);
    const rectangle = selectionRectangle(marquee.start, current);
    if (rectangle.width + rectangle.height > DRAG_THRESHOLD) marquee.moved = true;
    if (!marquee.moved) return;
    applyRectangle(marqueeElement, rectangle);
    marqueeElement?.removeAttribute('hidden');
    items.clear();
    marquee.initial.forEach(id => items.add(id));
    for (const node of canvas.querySelectorAll('[data-dmt-node]')) {
      if (rectanglesIntersect(rectangle, nodeGeometry(node))) items.add(node.dataset.dmtNode);
    }
    primaryId = [...items].at(-1) || '';
    syncSelection({ announce: false });
    event.preventDefault();
  });

  listen(canvas, 'pointerup', event => {
    if (canvasPan && canvasPan.pointerId === event.pointerId) {
      canvasPan = null;
      viewport.classList.remove('is-panning');
      if (canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      event.preventDefault();
      return;
    }
    if (portDrag) {
      const sourceId = portDrag.id;
      const moved = portDrag.moved;
      const wasActive = portDrag.wasActive;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-dmt-node]');
      const targetId = target?.dataset.dmtNode || '';
      portDrag = null;
      suppressPortClick = true;
      canvas.querySelector('[data-dmt-preview]')?.setAttribute('hidden', '');
      if (moved) {
        cancelConnection();
        if (targetId && targetId !== sourceId) onConnect?.(sourceId, targetId);
      } else if (wasActive) {
        cancelConnection();
      }
      event.preventDefault();
      return;
    }
    if (nodeDrag) {
      finishNodeDrag(event);
      return;
    }
    if (!marquee) return;
    const moved = marquee.moved;
    marquee = null;
    marqueeElement?.setAttribute('hidden', '');
    if (moved) syncSelection();
  });

  listen(canvas, 'pointercancel', event => {
    if (canvasPan && canvasPan.pointerId === event.pointerId) {
      canvasPan = null;
      viewport.classList.remove('is-panning');
      if (canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }
    if (nodeDrag) finishNodeDrag(event);
    marquee = null;
    marqueeElement?.setAttribute('hidden', '');
    if (portDrag) cancelConnection();
  });

  listen(root, 'dragstart', event => {
    const tool = event.target.closest('[data-dmt-create-kind]');
    if (!tool) return;
    draggedTool = {
      kind: tool.dataset.dmtCreateKind,
      subtype: tool.dataset.dmtCreateSubtype || '',
    };
    event.dataTransfer?.setData('text/plain', `${draggedTool.kind}:${draggedTool.subtype}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    root.classList.add('is-controls-open');
  });
  listen(viewport, 'dragover', event => {
    if (!draggedTool) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  listen(viewport, 'drop', event => {
    if (!draggedTool) return;
    event.preventDefault();
    const position = pointInCanvas(event, canvas);
    onCreate?.(draggedTool.kind, draggedTool.subtype, {
      x: Math.max(0, position.x - 120),
      y: Math.max(0, position.y - 58),
    });
    draggedTool = null;
  });
  listen(root, 'dragend', () => {
    draggedTool = null;
    root.classList.remove('is-controls-open');
  });

  listen(viewport, 'wheel', event => {
    event.preventDefault();
    const delta = normalizedWheelDelta(event);
    if (!Number.isFinite(delta) || delta === 0) return;
    if (accumulatedWheelDelta && Math.sign(accumulatedWheelDelta) !== Math.sign(delta)) {
      accumulatedWheelDelta = 0;
    }
    accumulatedWheelDelta += delta;
    const steps = Math.floor(Math.abs(accumulatedWheelDelta) / WHEEL_ZOOM_DELTA_PER_STEP);
    if (!steps) return;
    const direction = accumulatedWheelDelta < 0 ? 1 : -1;
    accumulatedWheelDelta -= Math.sign(accumulatedWheelDelta)
      * steps
      * WHEEL_ZOOM_DELTA_PER_STEP;
    applyZoom(stepCanvasZoom(canvasZoom(canvas), direction, steps), {
      x: event.clientX,
      y: event.clientY,
    });
  }, { passive: false });

  listen(viewport, 'auxclick', event => {
    if (event.button === 1) event.preventDefault();
  });

  listen(root, 'keydown', event => {
    if (isTypingTarget(event.target)) return;
    const shortcutModal = root.querySelector('[data-dmt-shortcuts-modal]');
    const editModal = root.querySelector('[data-dmt-modal]');
    const activeModal = editModal
      || (shortcutModal && !shortcutModal.hasAttribute('hidden') ? shortcutModal : null);
    if (trapModalTab(event, activeModal)) return;
    const focusedNode = event.target.closest?.('[data-dmt-node]');
    const focusedEdge = event.target.closest?.('[data-dmt-edge-hit]');
    if (event.key === ' ' && focusedNode) {
      if (event.shiftKey) toggleItem(focusedNode.dataset.dmtNode);
      else selectOnlyItem(focusedNode.dataset.dmtNode);
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && focusedNode) {
      const id = focusedNode.dataset.dmtNode;
      if (!items.has(id) || items.size !== 1 || flows.size) selectOnlyItem(id, false);
      if (event.shiftKey) onOpen?.(id);
      else onEdit?.(id);
      event.preventDefault();
      return;
    }
    if ((event.key === ' ' || event.key === 'Enter') && focusedEdge) {
      selectEdge(focusedEdge.dataset.dmtEdgeHit, event.shiftKey);
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      if (shortcutModal && !shortcutModal.hasAttribute('hidden')) setShortcutModalOpen(root, false);
      else if (editModal) onCancelEdit?.();
      else if (connectionSource) cancelConnection();
      else if (root.classList.contains('is-fullscreen')) {
        void changeFullscreen(false);
      }
      else {
        items.clear();
        flows.clear();
        primaryId = '';
        syncSelection();
      }
      event.preventDefault();
      return;
    }
    if (editModal || (shortcutModal && !shortcutModal.hasAttribute('hidden'))) return;
    if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
      setShortcutModalOpen(root, true);
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      items.clear();
      flows.clear();
      canvas.querySelectorAll('[data-dmt-node]').forEach(node => items.add(node.dataset.dmtNode));
      primaryId = [...items][0] || '';
      syncSelection();
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      onUndo?.();
      event.preventDefault();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && (items.size || flows.size)) {
      onDeleteSelection?.([...items], [...flows]);
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === 'c' && items.size === 1 && !flows.size) {
      startConnection([...items][0]);
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && items.size === 1 && !flows.size) {
      if (event.shiftKey) onOpen?.([...items][0]);
      else onEdit?.([...items][0]);
      event.preventDefault();
      return;
    }
    const offsets = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!offsets[event.key] || !items.size) return;
    const distance = event.shiftKey ? GRID * 4 : GRID;
    const [dx, dy] = offsets[event.key];
    const selectedGeometries = [...items].map(nodeFor).filter(Boolean).map(nodeGeometry);
    const requestedX = dx * distance;
    const requestedY = dy * distance;
    const moveX = Math.max(requestedX, -Math.min(...selectedGeometries.map(value => value.x)));
    const moveY = Math.max(requestedY, -Math.min(...selectedGeometries.map(value => value.y)));
    const updates = {};
    for (const id of items) {
      const node = nodeFor(id);
      if (!node) continue;
      const geometry = nodeGeometry(node);
      const x = geometry.x + moveX;
      const y = geometry.y + moveY;
      setNodePosition(node, x, y);
      updates[id] = { x, y };
    }
    redraw(canvas, layoutText);
    updateHull();
    onMove?.(updates);
    event.preventDefault();
  });

  const firstDialogControl = root.querySelector('[data-dmt-modal] input[name="title"]')
    || root.querySelector('[data-dmt-modal] button:not([tabindex="-1"])');
  const initialZoom = canvasZoom(canvas);
  canvas.dataset.dmtZoom = String(initialZoom);
  canvas.dataset.dmtDetail = storyCanvasDetailLevel(initialZoom);
  syncZoomControls(initialZoom);
  activeScaleFactor = applyCanvasCssVariables(canvas, initialZoom);
  for (const node of canvas.querySelectorAll('[data-dmt-node]')) {
    setNodePosition(node, node.dataset.dmtX, node.dataset.dmtY, initialZoom);
  }
  syncCanvasViewportSize(initialZoom);
  viewport.scrollLeft = panMargin;
  viewport.scrollTop = panMargin;
  if (ownerDocument) {
    const fullscreenChange = () => syncFullscreenState(nativeFullscreenActive());
    listen(ownerDocument, 'fullscreenchange', fullscreenChange);
    listen(ownerDocument, 'webkitfullscreenchange', fullscreenChange);
    listen(ownerDocument, 'fullscreenerror', () => syncFullscreenState(false));
    const target = ownerDocument.documentElement;
    const supportsNativeFullscreen = typeof (target?.requestFullscreen
      || target?.webkitRequestFullscreen) === 'function';
    if (supportsNativeFullscreen && root.classList.contains('is-fullscreen')
      && !nativeFullscreenActive()) syncFullscreenState(false);
  }
  const handleCanvasResize = () => {
    const zoom = canvasZoom(canvas);
    if (renderingScaleFactor(canvas) !== activeScaleFactor) {
      activeScaleFactor = applyCanvasCssVariables(canvas, zoom);
      for (const node of canvas.querySelectorAll('[data-dmt-node]')) {
        setNodePosition(node, node.dataset.dmtX, node.dataset.dmtY, zoom);
      }
      syncNodeTextLayouts(canvas, layoutText, zoom);
      redraw(canvas, layoutText);
      updateHull();
    }
    syncCanvasViewportSize(zoom);
  };
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(handleCanvasResize);
    observer.observe(viewport);
    removers.push(() => observer.disconnect());
  } else if (typeof window !== 'undefined') {
    listen(window, 'resize', handleCanvasResize);
  }
  if (firstDialogControl) firstDialogControl.focus({ preventScroll: true });
  else if (items.size === 1 && !flows.size) nodeFor([...items][0])?.focus({ preventScroll: true });
  syncNodeTextLayouts(canvas, layoutText, initialZoom);
  redraw(canvas, layoutText);
  updateHull();
  return () => {
    viewport.classList.remove('is-panning');
    removers.splice(0).reverse().forEach(remove => remove());
  };
}
