import {
  CANVAS_ZOOM_EPSILON,
  MAX_CANVAS_ZOOM,
  clampCanvasZoom,
} from './story-planner-zoom.js';

const BASE_CARD_GEOMETRY = Object.freeze({
  width: 240,
  minHeight: 116,
  padding: 12,
  borderWidth: 2,
  titleMargin: 4,
  headerGap: 8,
  metaGap: 4,
  metaMarginTop: 8,
  badgePaddingBlock: 2.4,
  badgePaddingInline: 7.2,
  marginaliaSize: 28,
});

const TYPOGRAPHY_BANDS = Object.freeze([
  Object.freeze({
    id: 'minimum',
    maxZoom: 0.6,
    titleFontSize: 15,
    titleLineHeight: 18,
    bodyFontSize: 10,
    bodyLineHeight: 14,
    edgeFontSize: 10,
    edgeLineHeight: 14,
    edgeStrokeWidth: 5,
  }),
  Object.freeze({
    id: 'small',
    maxZoom: 0.8,
    titleFontSize: 17,
    titleLineHeight: 20,
    bodyFontSize: 11,
    bodyLineHeight: 15,
    edgeFontSize: 11,
    edgeLineHeight: 15,
    edgeStrokeWidth: 5,
  }),
  Object.freeze({
    id: 'standard',
    maxZoom: 1,
    titleFontSize: 20,
    titleLineHeight: 23,
    bodyFontSize: 12,
    bodyLineHeight: 17,
    edgeFontSize: 12,
    edgeLineHeight: 16,
    edgeStrokeWidth: 6,
  }),
  Object.freeze({
    id: 'large',
    maxZoom: 1.25,
    titleFontSize: 24,
    titleLineHeight: 28,
    bodyFontSize: 15,
    bodyLineHeight: 21,
    edgeFontSize: 15,
    edgeLineHeight: 20,
    edgeStrokeWidth: 7,
  }),
  Object.freeze({
    id: 'larger',
    maxZoom: 1.5,
    titleFontSize: 29,
    titleLineHeight: 33,
    bodyFontSize: 18,
    bodyLineHeight: 25,
    edgeFontSize: 18,
    edgeLineHeight: 24,
    edgeStrokeWidth: 8,
  }),
  Object.freeze({
    id: 'largest',
    maxZoom: 1.75,
    titleFontSize: 34,
    titleLineHeight: 39,
    bodyFontSize: 21,
    bodyLineHeight: 29,
    edgeFontSize: 21,
    edgeLineHeight: 28,
    edgeStrokeWidth: 9,
  }),
  Object.freeze({
    id: 'maximum',
    maxZoom: MAX_CANVAS_ZOOM,
    titleFontSize: 38,
    titleLineHeight: 44,
    bodyFontSize: 24,
    bodyLineHeight: 34,
    edgeFontSize: 24,
    edgeLineHeight: 32,
    edgeStrokeWidth: 10,
  }),
]);

function deviceScaleFactor(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function snappedHairline(value, scaleFactor) {
  const factor = deviceScaleFactor(scaleFactor);
  return Math.max(1 / factor, snapToDevicePixel(value, factor));
}

/**
 * Text is always rasterized at an explicit integer CSS-pixel size. The first
 * band remains active below 60%, so overview zoom changes geometry and wrapping
 * without shrinking text into increasingly soft fractional sizes.
 */
export function storyCanvasTypography(value) {
  const zoom = clampCanvasZoom(value);
  return TYPOGRAPHY_BANDS.find(band => zoom <= band.maxZoom + CANVAS_ZOOM_EPSILON)
    || TYPOGRAPHY_BANDS.at(-1);
}

export function snapToDevicePixel(value, scaleFactor = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = deviceScaleFactor(scaleFactor);
  const snapped = Math.round(numeric * factor) / factor;
  return Object.is(snapped, -0) ? 0 : snapped;
}

/**
 * CSS card geometry is derived here because Pretext must measure the same
 * content width that the browser renders. Graph positions themselves remain
 * unsnapped and are converted only when written to the DOM.
 */
export function storyCanvasCardMetrics(value, scaleFactor = 1) {
  const zoom = clampCanvasZoom(value);
  const factor = deviceScaleFactor(scaleFactor);
  const width = snapToDevicePixel(BASE_CARD_GEOMETRY.width * zoom, factor);
  const padding = snapToDevicePixel(BASE_CARD_GEOMETRY.padding * zoom, factor);
  const borderWidth = snappedHairline(BASE_CARD_GEOMETRY.borderWidth * zoom, factor);
  return Object.freeze({
    width,
    minHeight: snapToDevicePixel(BASE_CARD_GEOMETRY.minHeight * zoom, factor),
    padding,
    borderWidth,
    contentWidth: Math.max(1 / factor, width - (padding + borderWidth) * 2),
    titleMargin: snapToDevicePixel(BASE_CARD_GEOMETRY.titleMargin * zoom, factor),
    headerGap: snapToDevicePixel(BASE_CARD_GEOMETRY.headerGap * zoom, factor),
    metaGap: snapToDevicePixel(BASE_CARD_GEOMETRY.metaGap * zoom, factor),
    metaMarginTop: snapToDevicePixel(BASE_CARD_GEOMETRY.metaMarginTop * zoom, factor),
    badgePaddingBlock: snapToDevicePixel(
      BASE_CARD_GEOMETRY.badgePaddingBlock * zoom,
      factor,
    ),
    badgePaddingInline: snapToDevicePixel(
      BASE_CARD_GEOMETRY.badgePaddingInline * zoom,
      factor,
    ),
    hairline: snappedHairline(zoom, factor),
    marginaliaSize: snapToDevicePixel(BASE_CARD_GEOMETRY.marginaliaSize * zoom, factor),
  });
}

export function storyCanvasRenderingMetrics(value, scaleFactor = 1) {
  const zoom = clampCanvasZoom(value);
  const typography = storyCanvasTypography(zoom);
  return Object.freeze({
    zoom,
    typography,
    card: storyCanvasCardMetrics(zoom, scaleFactor),
    // SVG text lives in zoom-1 graph coordinates. Dividing here produces the
    // integer visible size after the viewBox is scaled to the canvas.
    edgeFontSize: typography.edgeFontSize / zoom,
    edgeLineHeight: typography.edgeLineHeight / zoom,
    edgeStrokeWidth: typography.edgeStrokeWidth / zoom,
  });
}

export function storyCanvasCssVariables(value, scaleFactor = 1) {
  const metrics = storyCanvasRenderingMetrics(value, scaleFactor);
  const { typography, card } = metrics;
  return Object.freeze({
    '--dmt-canvas-zoom': String(metrics.zoom),
    '--dmt-title-font-size': `${typography.titleFontSize}px`,
    '--dmt-title-line-height': `${typography.titleLineHeight}px`,
    '--dmt-body-font-size': `${typography.bodyFontSize}px`,
    '--dmt-body-line-height': `${typography.bodyLineHeight}px`,
    '--dmt-edge-font-size': `${metrics.edgeFontSize}px`,
    '--dmt-edge-stroke-width': `${metrics.edgeStrokeWidth}px`,
    '--dmt-node-width': `${card.width}px`,
    '--dmt-node-min-height': `${card.minHeight}px`,
    '--dmt-node-padding': `${card.padding}px`,
    '--dmt-node-border': `${card.borderWidth}px`,
    '--dmt-node-title-margin': `${card.titleMargin}px`,
    '--dmt-node-header-gap': `${card.headerGap}px`,
    '--dmt-node-meta-gap': `${card.metaGap}px`,
    '--dmt-node-meta-margin': `${card.metaMarginTop}px`,
    '--dmt-node-badge-padding-block': `${card.badgePaddingBlock}px`,
    '--dmt-node-badge-padding-inline': `${card.badgePaddingInline}px`,
    '--dmt-node-hairline': `${card.hairline}px`,
    '--dmt-node-marginalia-size': `${card.marginaliaSize}px`,
  });
}
