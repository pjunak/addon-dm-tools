import { orthogonalPath } from './story-planner-model.js';

const GRID = 24;

function pointInCanvas(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left + canvas.scrollLeft,
    y: event.clientY - bounds.top + canvas.scrollTop,
  };
}

function nodeGeometry(node) {
  return {
    x: Number.parseFloat(node.style.left) || 0,
    y: Number.parseFloat(node.style.top) || 0,
    width: node.offsetWidth,
    height: node.offsetHeight,
  };
}

function redraw(canvas) {
  for (const edge of canvas.querySelectorAll('[data-dmt-edge]')) {
    const source = canvas.querySelector(`[data-dmt-node="${CSS.escape(edge.dataset.source)}"]`);
    const target = canvas.querySelector(`[data-dmt-node="${CSS.escape(edge.dataset.target)}"]`);
    if (source && target) edge.setAttribute('d', orthogonalPath(
      nodeGeometry(source),
      nodeGeometry(target),
    ));
  }
}

export function mountStoryCanvas({
  root,
  onSelect,
  onOpen,
  onMove,
  onConnect,
  onConnectStart,
}) {
  const canvas = root?.querySelector('.dmt-story-canvas');
  if (!canvas) return () => {};
  const removers = [];
  let connectionSource = '';

  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  for (const node of canvas.querySelectorAll('[data-dmt-node]')) {
    const itemId = node.dataset.dmtNode;
    let drag = null;
    let suppressClick = false;
    listen(node, 'click', event => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        return;
      }
      if (event.defaultPrevented || event.target.closest('.dmt-node-port')) return;
      if (connectionSource && connectionSource !== itemId) {
        const source = connectionSource;
        connectionSource = '';
        canvas.classList.remove('is-connecting');
        onConnect(source, itemId);
        return;
      }
      onSelect(itemId);
    });
    listen(node, 'dblclick', event => {
      if (event.target.closest('button, a, input, textarea, select')) return;
      event.preventDefault();
      onOpen(itemId);
    });
    listen(node, 'keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onOpen(itemId);
      } else if (event.key === ' ') {
        event.preventDefault();
        onSelect(itemId);
      }
    });
    listen(node, 'pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button, a, input, textarea, select')) return;
      const start = pointInCanvas(event, canvas);
      const position = nodeGeometry(node);
      drag = { start, position, moved: false };
      node.setPointerCapture?.(event.pointerId);
    });
    listen(node, 'pointermove', event => {
      if (!drag) return;
      const current = pointInCanvas(event, canvas);
      const dx = current.x - drag.start.x;
      const dy = current.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      node.style.left = `${Math.max(0, drag.position.x + dx)}px`;
      node.style.top = `${Math.max(0, drag.position.y + dy)}px`;
      redraw(canvas);
      event.preventDefault();
    });
    const finishDrag = event => {
      if (!drag) return;
      if (drag.moved) {
        suppressClick = true;
        const x = Math.round((Number.parseFloat(node.style.left) || 0) / GRID) * GRID;
        const y = Math.round((Number.parseFloat(node.style.top) || 0) / GRID) * GRID;
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        redraw(canvas);
        onMove(itemId, { x, y });
        event.preventDefault();
      }
      drag = null;
    };
    listen(node, 'pointerup', finishDrag);
    listen(node, 'pointercancel', finishDrag);

    const port = node.querySelector('.dmt-node-port');
    if (!port) continue;
    let suppressPortClick = false;
    let portDrag = null;
    listen(port, 'click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (suppressPortClick) {
        suppressPortClick = false;
        return;
      }
      connectionSource = connectionSource === itemId ? '' : itemId;
      canvas.classList.toggle('is-connecting', !!connectionSource);
      onConnectStart(connectionSource);
    });
    let preview = null;
    listen(port, 'pointerdown', event => {
      if (event.button !== 0) return;
      event.stopPropagation();
      connectionSource = itemId;
      canvas.classList.add('is-connecting');
      portDrag = { x: event.clientX, y: event.clientY, moved: false };
      preview = canvas.querySelector('[data-dmt-preview]');
      preview?.removeAttribute('hidden');
      port.setPointerCapture?.(event.pointerId);
      onConnectStart(itemId);
    });
    listen(port, 'pointermove', event => {
      if (!preview || connectionSource !== itemId) return;
      if (portDrag && Math.abs(event.clientX - portDrag.x) + Math.abs(event.clientY - portDrag.y) > 4) {
        portDrag.moved = true;
      }
      const source = nodeGeometry(node);
      const targetPoint = pointInCanvas(event, canvas);
      preview.setAttribute('d', orthogonalPath(source, {
        x: targetPoint.x,
        y: targetPoint.y,
        width: 0,
        height: 0,
      }));
    });
    const finishConnection = event => {
      if (!preview || connectionSource !== itemId) return;
      preview.setAttribute('hidden', '');
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-dmt-node]');
      const targetId = target?.dataset.dmtNode || '';
      const sourceId = connectionSource;
      connectionSource = '';
      canvas.classList.remove('is-connecting');
      onConnectStart('');
      suppressPortClick = !!portDrag?.moved;
      if (targetId && targetId !== sourceId) {
        suppressPortClick = true;
        onConnect(sourceId, targetId);
      }
      portDrag = null;
      preview = null;
      event.preventDefault();
    };
    listen(port, 'pointerup', finishConnection);
    listen(port, 'pointercancel', finishConnection);
  }

  redraw(canvas);
  return () => removers.splice(0).reverse().forEach(remove => remove());
}
