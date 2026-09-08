import { nativePixel } from "./planner-viewport.js";
// Selection is view-local. A completed gesture publishes all positions in one write.
export function mountCanvasSelection(options) {
    const { viewport, stage, positions, zoom } = options;
    const document = stage.ownerDocument;
    let selection = options.selection, suppressClick = false;
    const cards = new Map([...stage.querySelectorAll("[data-item-id]")].map(card => [card.dataset["itemId"], card]));
    const hull = document.createElement("div");
    hull.className = "dm-selection-hull";
    hull.hidden = true;
    stage.append(hull);
    const marquee = document.createElement("div");
    marquee.className = "dm-selection-marquee";
    marquee.hidden = true;
    stage.append(marquee);
    const geometry = (card) => ({ x: parseFloat(card.style.left), y: parseFloat(card.style.top), width: card.offsetWidth || parseFloat(card.style.width), height: card.offsetHeight || parseFloat(card.style.minHeight) });
    const paint = () => {
        for (const [id, card] of cards) {
            card.classList.toggle("selected", selection.items.has(id));
            card.setAttribute("aria-pressed", String(selection.items.has(id)));
        }
        for (const path of stage.querySelectorAll("[data-flow-id]"))
            path.classList.toggle("selected", selection.flows.has(path.getAttribute("data-flow-id")));
        for (const hit of stage.querySelectorAll("[data-select-flow]"))
            hit.setAttribute("aria-pressed", String(selection.flows.has(hit.getAttribute("data-select-flow"))));
        const boxes = [...selection.items].map(id => cards.get(id)).filter((card) => !!card).map(geometry);
        hull.hidden = boxes.length < 2;
        if (!hull.hidden) {
            const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
            Object.assign(hull.style, { left: `${left - 10}px`, top: `${top - 10}px`, width: `${Math.max(...boxes.map(box => box.x + box.width)) - left + 20}px`, height: `${Math.max(...boxes.map(box => box.y + box.height)) - top + 20}px` });
        }
    };
    const change = (items, flows = new Set(), primary = [...items][0]) => {
        selection = { items, flows, primary };
        paint();
        options.change(selection);
    };
    const toggle = (id, kind, additive) => {
        const items = new Set(additive ? selection.items : []), flows = new Set(additive ? selection.flows : []), values = kind === "items" ? items : flows;
        if (values.has(id))
            values.delete(id);
        else
            values.add(id);
        change(items, flows, kind === "items" && items.has(id) ? id : [...items][0]);
    };
    viewport.addEventListener("click", event => {
        if (suppressClick) {
            suppressClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.defaultPrevented || !options.available())
            return;
        const target = event.target, edge = target.closest("[data-select-flow]");
        if (edge) {
            toggle(edge.getAttribute("data-select-flow"), "flows", event.shiftKey);
            viewport.focus({ preventScroll: true });
        }
        // Keyboard and assistive-technology clicks have no preceding pointer gesture.
        const card = target.closest("[data-item-id]");
        if (card && event.detail === 0)
            toggle(card.dataset["itemId"], "items", event.shiftKey);
    });
    viewport.addEventListener("dblclick", event => {
        const card = event.target.closest("[data-item-id]");
        if (card && !event.defaultPrevented && !event.target.closest("button") && options.available()) {
            event.preventDefault();
            options.edit(card.dataset["itemId"]);
        }
    });
    viewport.addEventListener("keydown", event => {
        if (event.defaultPrevented || !options.available() || event.target.closest("input,textarea,select,button,a"))
            return;
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && event.key.toLowerCase() === "a") {
            event.preventDefault();
            change(new Set(cards.keys()));
        }
        else if (modifier && !event.shiftKey && event.key.toLowerCase() === "z") {
            event.preventDefault();
            options.undo();
        }
        else if (modifier || event.altKey)
            return;
        else if (event.key === "?") {
            event.preventDefault();
            options.help();
        }
        else if (event.key.toLowerCase() === "c" && selection.items.size === 1 && !selection.flows.size) {
            event.preventDefault();
            options.connect([...selection.items][0]);
        }
        else if (event.key === "Escape") {
            event.preventDefault();
            change(new Set());
        }
        else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            options.remove();
        }
        else if ((event.key === " " || event.key === "Enter") && event.target.hasAttribute("data-select-flow")) {
            event.preventDefault();
            toggle(event.target.getAttribute("data-select-flow"), "flows", event.shiftKey);
        }
        else if ((event.key === "Enter" || event.key.toLowerCase() === "e") && selection.items.size === 1 && !selection.flows.size) {
            event.preventDefault();
            const id = [...selection.items][0];
            if (event.key === "Enter" && event.shiftKey)
                options.open(id);
            else
                options.edit(id);
        }
        else if (event.key === " ") {
            const card = event.target.closest("[data-item-id]");
            if (card) {
                event.preventDefault();
                toggle(card.dataset["itemId"], "items", event.shiftKey);
            }
        }
        else if (event.key.startsWith("Arrow") && selection.items.size && !modifier) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const distance = event.shiftKey ? 96 : 24, dx = event.key === "ArrowRight" ? distance : event.key === "ArrowLeft" ? -distance : 0, dy = event.key === "ArrowDown" ? distance : event.key === "ArrowUp" ? -distance : 0;
            options.move(Object.fromEntries([...selection.items].map(id => { const point = positions.get(id); return [id, { x: point.x + dx, y: point.y + dy }]; })));
        }
    });
    viewport.addEventListener("pointerdown", event => {
        if (event.defaultPrevented || !options.available() || (event.button !== 0 && event.button !== 1))
            return;
        const target = event.target, card = target.closest("[data-item-id]");
        if (target.closest("button,input,textarea,select,a"))
            return;
        if (event.button === 0 && target.closest("[data-select-flow]")) {
            event.preventDefault();
            return;
        }
        // Touch on empty canvas keeps native scrolling; a card can still be dragged.
        if (event.pointerType === "touch" && !card)
            return;
        event.preventDefault();
        viewport.focus({ preventScroll: true });
        suppressClick = false;
        const initial = { items: new Set(selection.items), flows: new Set(selection.flows), primary: selection.primary };
        const pan = event.button === 1 || event.altKey;
        const left = viewport.scrollLeft, top = viewport.scrollTop, rect = stage.getBoundingClientRect();
        const start = { x: event.clientX, y: event.clientY };
        const id = card?.dataset["itemId"];
        let collapse = false;
        if (!pan && id) {
            if (event.shiftKey) {
                toggle(id, "items", true);
                if (!selection.items.has(id))
                    return;
            }
            else if (!selection.items.has(id))
                change(new Set([id]));
            else
                collapse = selection.items.size > 1 || selection.flows.size > 0;
        }
        const selected = !pan && id ? [...selection.items].map(key => ({ id: key, card: cards.get(key), point: positions.get(key), box: geometry(cards.get(key)) })) : [];
        let moved = false, dx = 0, dy = 0;
        const capture = card ?? viewport;
        capture.setPointerCapture(event.pointerId);
        const move = (next) => {
            if (next.pointerId !== event.pointerId)
                return;
            const x = next.clientX - start.x, y = next.clientY - start.y;
            if (Math.abs(x) + Math.abs(y) > 4)
                moved = true;
            if (!moved)
                return;
            if (pan) {
                viewport.scrollLeft = left - x;
                viewport.scrollTop = top - y;
                return;
            }
            if (selected.length) {
                dx = Math.round(x / zoom / 24) * 24;
                dy = Math.round(y / zoom / 24) * 24;
                for (const value of selected) {
                    value.card.style.left = `${nativePixel(value.box.x + dx * zoom)}px`;
                    value.card.style.top = `${nativePixel(value.box.y + dy * zoom)}px`;
                }
                paint();
                return;
            }
            const box = { x: Math.min(start.x, next.clientX) - rect.left, y: Math.min(start.y, next.clientY) - rect.top, width: Math.abs(x), height: Math.abs(y) };
            marquee.hidden = false;
            Object.assign(marquee.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
            const items = new Set(event.shiftKey ? initial.items : []);
            for (const [key, value] of cards) {
                const cardBox = geometry(value);
                if (cardBox.x < box.x + box.width && cardBox.x + cardBox.width > box.x && cardBox.y < box.y + box.height && cardBox.y + cardBox.height > box.y)
                    items.add(key);
            }
            change(items, new Set(event.shiftKey ? initial.flows : []));
        };
        const end = (next) => {
            if (next.pointerId !== event.pointerId)
                return;
            viewport.removeEventListener("pointermove", move);
            viewport.removeEventListener("pointerup", end);
            viewport.removeEventListener("pointercancel", end);
            viewport.removeEventListener("lostpointercapture", end);
            if (capture.hasPointerCapture(event.pointerId))
                capture.releasePointerCapture(event.pointerId);
            marquee.hidden = true;
            suppressClick = moved;
            if (next.type !== "pointerup") {
                for (const value of selected) {
                    value.card.style.left = `${value.box.x}px`;
                    value.card.style.top = `${value.box.y}px`;
                }
                change(initial.items, initial.flows, initial.primary);
                return;
            }
            if (selected.length && moved && (dx || dy))
                options.move(Object.fromEntries(selected.map(value => [value.id, { x: value.point.x + dx, y: value.point.y + dy }])));
            else if (!moved && !pan) {
                if (collapse && id)
                    change(new Set([id]));
                else if (!id)
                    change(new Set());
            }
        };
        viewport.addEventListener("pointermove", move);
        viewport.addEventListener("pointerup", end);
        viewport.addEventListener("pointercancel", end);
        viewport.addEventListener("lostpointercapture", end);
    });
    paint();
}
