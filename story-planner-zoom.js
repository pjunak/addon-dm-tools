export const MIN_CANVAS_ZOOM = 0.35;
export const MAX_CANVAS_ZOOM = 2;
export const CANVAS_ZOOM_STEP = 0.1;
export const OVERVIEW_DETAIL_ZOOM = 0.45;
export const COMPACT_DETAIL_ZOOM = 0.6;
export const FULL_DETAIL_ZOOM = 1;
export const TYPOGRAPHY_ZOOM_STEP = 0.25;
export const OVERVIEW_TYPOGRAPHY_ZOOM = 0.5;
export const OVERVIEW_TYPOGRAPHY_SCALE = 0.75;

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
 * Canvas geometry follows every zoom change. Text uses a compact native band
 * only for the extreme overview, stays at its zoom-1 size from 50% through
 * 124%, and grows in quarter steps above that. Discrete bands avoid continuous
 * font reflow without forcing dense plans to keep full-size titles at 35%.
 */
export function storyCanvasTypographyScale(value) {
  const zoom = clampCanvasZoom(value);
  if (zoom < OVERVIEW_TYPOGRAPHY_ZOOM) return OVERVIEW_TYPOGRAPHY_SCALE;
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
