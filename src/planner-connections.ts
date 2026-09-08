interface ConnectionOptions {
  viewport: HTMLElement; stage: HTMLElement; svg: SVGSVGElement; zoom: number;
  available: () => boolean; active: (value: boolean) => void;
  connect: (source: string, target: string) => void;
}

// A connection stays local until a complete gesture chooses a different card.
export function mountCanvasConnections(options: ConnectionOptions): { start: (id: string) => void; dispose: () => void } {
  const { viewport, stage, svg, zoom } = options, document = stage.ownerDocument;
  const cards = new Map([...stage.querySelectorAll<HTMLElement>("[data-item-id]")].map(card => [card.dataset["itemId"]!, card]));
  let source: string | undefined, pointer: number | undefined, startX = 0, startY = 0, moved = false, suppressClick = false;
  const preview = document.createElementNS("http://www.w3.org/2000/svg", "path"); preview.classList.add("dm-connection-preview"); preview.setAttribute("hidden", ""); svg.append(preview);
  const notice = document.createElement("p"); notice.className = "dm-connection-notice"; notice.setAttribute("role", "status"); notice.hidden = true; viewport.append(notice);
  const paint = (x: number, y: number): void => {
    const card = source ? cards.get(source) : undefined; if (!card) return;
    const rect = stage.getBoundingClientRect(), box = card.getBoundingClientRect();
    const sx = (box.right - rect.left) / zoom, sy = (box.top + box.height / 2 - rect.top) / zoom, tx = (x - rect.left) / zoom, ty = (y - rect.top) / zoom;
    const bend = Math.max(48, Math.abs(tx - sx) / 2);
    preview.setAttribute("d", `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`);
  };
  const cancel = (): void => {
    const captured = pointer; pointer = undefined;
    if (captured !== undefined && viewport.hasPointerCapture(captured)) viewport.releasePointerCapture(captured);
    source = undefined; preview.setAttribute("hidden", ""); notice.hidden = true;
    for (const card of cards.values()) card.classList.remove("connecting");
    options.active(false);
  };
  const start = (id: string): void => {
    if (!options.available() || !cards.has(id)) return; cancel(); source = id; options.active(true);
    const card = cards.get(id)!; card.classList.add("connecting"); preview.removeAttribute("hidden");
    notice.textContent = `Connect from ${card.getAttribute("aria-label")}. Choose another card; Escape cancels.`; notice.hidden = false;
    const box = card.getBoundingClientRect(); paint(box.right + 60, box.top + box.height / 2);
  };
  const finish = (target?: string): void => {
    const from = source; cancel();
    if (from && target && from !== target && cards.has(target) && options.available()) options.connect(from, target);
  };
  viewport.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !options.available()) return;
    const port = (event.target as Element).closest<HTMLElement>("[data-flow-port]");
    if (!source && !port) return;
    event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
    if (port) start(port.dataset["flowPort"]!);
    pointer = event.pointerId; startX = event.clientX; startY = event.clientY; moved = false;
    viewport.focus({ preventScroll: true }); viewport.setPointerCapture(pointer);
  });
  viewport.addEventListener("pointermove", event => {
    if (!source || (pointer !== undefined && pointer !== event.pointerId)) return;
    paint(event.clientX, event.clientY);
    if (pointer !== undefined && Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > 4) moved = true;
  });
  const end = (event: PointerEvent): void => {
    if (pointer !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation(); pointer = undefined;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    suppressClick = true;
    if (event.type !== "pointerup") { cancel(); return; }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!moved && target?.closest<HTMLElement>("[data-flow-port]")?.dataset["flowPort"] === source) return;
    finish(target?.closest<HTMLElement>("[data-item-id]")?.dataset["itemId"]);
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) viewport.addEventListener(type, end);
  viewport.addEventListener("click", event => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); return; }
    const target = event.target as Element, port = target.closest<HTMLElement>("[data-flow-port]");
    if (!source && !port) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (port) start(port.dataset["flowPort"]!); else finish(target.closest<HTMLElement>("[data-item-id]")?.dataset["itemId"]);
  });
  viewport.addEventListener("keydown", event => {
    if (!source) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    else if ((event.key === "Enter" || event.key === " ") && !(event.target as Element).closest("button,input,select,textarea,a")) {
      event.preventDefault(); event.stopImmediatePropagation(); finish((event.target as Element).closest<HTMLElement>("[data-item-id]")?.dataset["itemId"]);
    }
  });
  return { start, dispose: cancel };
}
