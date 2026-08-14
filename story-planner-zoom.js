export const MIN_CANVAS_ZOOM = 0.35;
export const MAX_CANVAS_ZOOM = 2;
export const CANVAS_ZOOM_STEP = 0.1;
export const OVERVIEW_DETAIL_ZOOM = 0.45;
export const COMPACT_DETAIL_ZOOM = 0.6;
export const FULL_DETAIL_ZOOM = 1;
export const CANVAS_ZOOM_EPSILON = 1e-9;

export function clampCanvasZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, numeric));
}

export function storyCanvasDetailLevel(value) {
  const zoom = clampCanvasZoom(value);
  if (zoom < OVERVIEW_DETAIL_ZOOM - CANVAS_ZOOM_EPSILON) return 'overview';
  if (zoom < COMPACT_DETAIL_ZOOM - CANVAS_ZOOM_EPSILON) return 'compact';
  if (zoom < FULL_DETAIL_ZOOM - CANVAS_ZOOM_EPSILON) return 'condensed';
  return 'full';
}
