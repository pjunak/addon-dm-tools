export const CANVAS_ZOOM_LEVELS = Object.freeze([
  0.35,
  0.45,
  0.55,
  0.6,
  0.7,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
]);
export const MIN_CANVAS_ZOOM = CANVAS_ZOOM_LEVELS[0];
export const MAX_CANVAS_ZOOM = CANVAS_ZOOM_LEVELS[CANVAS_ZOOM_LEVELS.length - 1];
export const OVERVIEW_DETAIL_ZOOM = 0.45;
export const COMPACT_DETAIL_ZOOM = 0.6;
export const FULL_DETAIL_ZOOM = 1;
export const CANVAS_ZOOM_EPSILON = 1e-9;

export function clampCanvasZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, numeric));
}

export function normalizeCanvasZoom(value) {
  const zoom = clampCanvasZoom(value);
  return CANVAS_ZOOM_LEVELS.reduce((nearest, level) => (
    Math.abs(level - zoom) < Math.abs(nearest - zoom) ? level : nearest
  ));
}

export function stepCanvasZoom(value, direction, stepCount = 1) {
  const current = normalizeCanvasZoom(value);
  const currentIndex = CANVAS_ZOOM_LEVELS.indexOf(current);
  const count = Math.max(0, Math.floor(Math.abs(Number(stepCount) || 0)));
  const offset = Math.sign(Number(direction) || 0) * count;
  const nextIndex = Math.min(
    CANVAS_ZOOM_LEVELS.length - 1,
    Math.max(0, currentIndex + offset),
  );
  return CANVAS_ZOOM_LEVELS[nextIndex];
}

export function storyCanvasDetailLevel(value) {
  const zoom = clampCanvasZoom(value);
  if (zoom < OVERVIEW_DETAIL_ZOOM - CANVAS_ZOOM_EPSILON) return 'overview';
  if (zoom < COMPACT_DETAIL_ZOOM - CANVAS_ZOOM_EPSILON) return 'compact';
  if (zoom < FULL_DETAIL_ZOOM - CANVAS_ZOOM_EPSILON) return 'condensed';
  return 'full';
}
