export const MIN_CANVAS_ZOOM = 0.5;
export const MAX_CANVAS_ZOOM = 2;
export const CANVAS_ZOOM_STEP = 0.1;
export const FULL_DETAIL_ZOOM = 0.75;

export function clampCanvasZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, numeric));
}

export function storyCanvasDetailLevel(value) {
  return clampCanvasZoom(value) < FULL_DETAIL_ZOOM ? 'compact' : 'full';
}
