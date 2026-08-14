export const MIN_CANVAS_ZOOM = 0.5;
export const MAX_CANVAS_ZOOM = 2;
export const CANVAS_ZOOM_STEP = 0.1;
export const OVERVIEW_DETAIL_ZOOM = 0.55;
export const COMPACT_DETAIL_ZOOM = 0.75;
export const FULL_DETAIL_ZOOM = 1;
export const TYPOGRAPHY_ZOOM_STEP = 0.25;

export function clampCanvasZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, numeric));
}

export function storyCanvasDetailLevel(value) {
  const zoom = clampCanvasZoom(value);
  if (zoom < OVERVIEW_DETAIL_ZOOM) return 'overview';
  if (zoom < COMPACT_DETAIL_ZOOM) return 'compact';
  if (zoom < FULL_DETAIL_ZOOM) return 'condensed';
  return 'full';
}

/**
 * Canvas geometry follows every zoom change, but text never shrinks below its
 * zoom-1 size. Above 100%, quarter-step sizes avoid continuous font reflow while
 * still letting typography grow with the surrounding cards.
 */
export function storyCanvasTypographyScale(value) {
  const zoom = clampCanvasZoom(value);
  if (zoom <= 1) return 1;
  return Math.min(
    MAX_CANVAS_ZOOM,
    Math.floor((zoom + Number.EPSILON) / TYPOGRAPHY_ZOOM_STEP) * TYPOGRAPHY_ZOOM_STEP,
  );
}

export function storyCanvasEdgeTypographyScale(value) {
  const zoom = clampCanvasZoom(value);
  return storyCanvasTypographyScale(zoom) / zoom;
}
