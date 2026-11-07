import { canvasText, type CanvasMessage, type I18n } from "./messages.js";
import type { PlanningItem, PlanningView } from "./planning-model.js";

/** The preserved planner's fixed ladder always includes a native 100% stop. */
export const zoomLevels = [
  0.35, 0.45, 0.55, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
] as const;
export function stepZoom(current: number, direction: number): number {
  const nearest = zoomLevels.reduce<number>(
    (best, level) => (Math.abs(level - current) < Math.abs(best - current) ? level : best),
    1,
  );
  return zoomLevels[
    Math.max(
      0,
      Math.min(
        zoomLevels.length - 1,
        zoomLevels.indexOf(nearest as (typeof zoomLevels)[number]) + Math.sign(direction),
      ),
    )
  ]!;
}
export function fittedZoom(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const limit = Math.min(
    1,
    Math.max(1, viewportWidth - 48) / Math.max(1, width),
    Math.max(1, viewportHeight - 48) / Math.max(1, height),
  );
  return [...zoomLevels].reverse().find((level) => level <= limit) ?? zoomLevels[0];
}
export interface CanvasView {
  zoom: number;
  x: number;
  y: number;
}
export interface CanvasPoint {
  x: number;
  y: number;
}
export function positionsFor(
  views: readonly Pick<PlanningView, "positions" | "scopeId">[],
  scopeId: string | null,
  items: readonly Pick<PlanningItem, "id">[],
): Map<string, CanvasPoint> {
  const view = views.find((candidate) => candidate.scopeId === scopeId),
    positions = new Map<string, CanvasPoint>();
  for (const item of items) {
    const saved = view?.positions[item.id];
    if (saved) positions.set(item.id, saved);
  }
  let slot = 0;
  for (const item of items) {
    if (positions.has(item.id)) continue;
    let point: CanvasPoint;
    do {
      point = { x: 72 + (slot % 3) * 300, y: 72 + Math.floor(slot / 3) * 190 };
      slot++;
    } while (
      [...positions.values()].some(
        (other) => Math.abs(other.x - point.x) < 264 && Math.abs(other.y - point.y) < 156,
      )
    );
    positions.set(item.id, point);
  }
  return positions;
}
export function canvasBounds(positions: Iterable<CanvasPoint>) {
  const points = [...positions];
  const left = Math.min(0, ...points.map((point) => point.x - 24)),
    top = Math.min(0, ...points.map((point) => point.y - 24));
  const right = Math.max(480, ...points.map((point) => point.x + 240 + 24)),
    bottom = Math.max(320, ...points.map((point) => point.y + 132 + 24));
  return { left, top, width: right - left, height: bottom - top };
}
export function nativePixel(value: number, scale = globalThis.devicePixelRatio || 1): number {
  return Math.round(value * scale) / scale;
}

const canvasKeys = {
  canvas: "canvas.canvas",
  controls: "canvas.controls",
  out: "canvas.out",
  reset: "canvas.reset",
  in: "canvas.in",
  fit: "canvas.fit",
  focus: "canvas.focus",
  fullscreen: "canvas.fullscreen",
  exit: "canvas.exit",
  help: "canvas.help",
} as const satisfies Record<string, CanvasMessage>;
export type CanvasLabels = Readonly<Record<keyof typeof canvasKeys, string>>;
/** The canvas controls' texts; the keys themselves before a translator exists. */
export function canvasLabels(i18n: I18n | undefined): CanvasLabels {
  const labels = {} as Record<keyof typeof canvasKeys, string>;
  for (const [name, key] of Object.entries(canvasKeys) as [
    keyof typeof canvasKeys,
    CanvasMessage,
  ][])
    labels[name] = i18n ? canvasText(i18n, key) : key;
  return labels;
}
