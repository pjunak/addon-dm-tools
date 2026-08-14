import { flowLabelGeometry } from './story-planner-model.js';
import {
  clampCanvasZoom,
  storyCanvasEdgeTypographyScale,
  storyCanvasTypographyScale,
} from './story-planner-zoom.js';

// Flow geometry uses zoom-1 coordinates, so this descriptor mirrors the host's
// --font-ui stack rather than reading scaled computed styles during a drag.
export const FLOW_LABEL_FONT = '12px Inter, "Helvetica Neue", sans-serif';
export const FLOW_LABEL_LINE_HEIGHT = 16;
const FLOW_LABEL_WIDTH_STEP = 0.5;
const STORY_NODE_WIDTH = 240;
const STORY_NODE_PADDING = 12;
const STORY_NODE_BORDER = 2;
const STORY_NODE_CONTENT_WIDTH = STORY_NODE_WIDTH - (STORY_NODE_PADDING + STORY_NODE_BORDER) * 2;
const STORY_NODE_WIDTH_STEP = 0.5;

const STORY_NODE_TEXT = Object.freeze({
  title: Object.freeze({
    baseFontSize: 19.2,
    family: 'Cinzel, Georgia, serif',
    letterSpacingEm: 0.012,
    lineHeightRatio: 1.15,
    maxLines: 2,
  }),
  summary: Object.freeze({
    baseFontSize: 12,
    family: 'Lora, Georgia, serif',
    letterSpacingEm: 0,
    lineHeightRatio: 1.4,
    maxLines: 2,
  }),
});

function widthBucket(value, step) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return step;
  return Math.max(step, Math.round(numeric / step) * step);
}

function layoutOptions(metrics) {
  return {
    font: metrics.font,
    maxWidth: metrics.maxWidth,
    lineHeight: metrics.lineHeight,
    letterSpacing: metrics.letterSpacing,
  };
}

function measuredLines(text, metrics, layoutText) {
  if (typeof layoutText !== 'function') return null;
  try {
    const result = layoutText(text, layoutOptions(metrics));
    return (result?.lines || []).map(line => String(line?.text ?? '')).filter(Boolean);
  } catch {
    return null;
  }
}

function ellipsizedLine(text, metrics, layoutText) {
  const suffix = '…';
  const characters = Array.from(String(text || '').trimEnd());
  if (!characters.length) return suffix;
  const fits = candidate => {
    const lines = measuredLines(candidate, metrics, layoutText);
    return lines?.length === 1 && lines[0] === candidate;
  };
  if (fits(`${characters.join('')}${suffix}`)) return `${characters.join('')}${suffix}`;
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(`${characters.slice(0, middle).join('').trimEnd()}${suffix}`)) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join('').trimEnd()}${suffix}`;
}

export function storyNodeTextMetrics(role, zoom = 1) {
  const descriptor = STORY_NODE_TEXT[role];
  if (!descriptor) throw new TypeError(`Unknown story node text role: ${role}`);
  const canvasZoom = clampCanvasZoom(zoom);
  const typeScale = storyCanvasTypographyScale(canvasZoom);
  const fontSize = descriptor.baseFontSize * typeScale;
  return Object.freeze({
    role,
    fontSize,
    font: `${fontSize}px ${descriptor.family}`,
    lineHeight: fontSize * descriptor.lineHeightRatio,
    letterSpacing: fontSize * descriptor.letterSpacingEm,
    maxLines: descriptor.maxLines,
    maxWidth: widthBucket(STORY_NODE_CONTENT_WIDTH * canvasZoom, STORY_NODE_WIDTH_STEP),
    typeScale,
  });
}

export function layoutStoryNodeText(text, role, zoom, layoutText) {
  const value = String(text ?? '');
  const metrics = storyNodeTextMetrics(role, zoom);
  const key = JSON.stringify([
    value,
    role,
    metrics.maxWidth,
    metrics.fontSize,
    metrics.letterSpacing,
    metrics.maxLines,
  ]);
  if (!value) return { key, lines: [], measured: true, metrics };
  const allLines = measuredLines(value, metrics, layoutText);
  if (!allLines) return { key, lines: [value], measured: false, metrics };
  const lines = allLines.slice(0, metrics.maxLines);
  if (allLines.length > metrics.maxLines) {
    lines[lines.length - 1] = ellipsizedLine(lines[lines.length - 1], metrics, layoutText);
  }
  return { key, lines, measured: true, metrics };
}

export function flowLabelLayoutWidth(maxWidth) {
  return widthBucket(maxWidth, FLOW_LABEL_WIDTH_STEP);
}

export function flowLabelTextMetrics(zoom = 1) {
  const canvasZoom = clampCanvasZoom(zoom);
  const graphScale = storyCanvasEdgeTypographyScale(canvasZoom);
  const fontSize = 12 * graphScale;
  return Object.freeze({
    font: `${fontSize}px Inter, "Helvetica Neue", sans-serif`,
    fontSize,
    lineHeight: FLOW_LABEL_LINE_HEIGHT * graphScale,
  });
}

export function flowLabelLayoutKey(text, maxWidth, zoom = 1) {
  const metrics = flowLabelTextMetrics(zoom);
  return JSON.stringify([
    String(text ?? ''),
    flowLabelLayoutWidth(maxWidth),
    metrics.fontSize,
    metrics.lineHeight,
  ]);
}

export function layoutFlowLabelLines(text, maxWidth, layoutText, zoom = 1) {
  const value = String(text ?? '');
  if (!value) return [];
  const metrics = flowLabelTextMetrics(zoom);
  if (typeof layoutText === 'function') {
    try {
      const result = layoutText(value, {
        font: metrics.font,
        maxWidth: flowLabelLayoutWidth(maxWidth),
        lineHeight: metrics.lineHeight,
      });
      const lines = (result?.lines || [])
        .map(line => String(line?.text ?? ''))
        .filter(Boolean);
      if (lines.length) return lines;
    } catch {
      // Older or partially compatible hosts keep the previous single-line label.
    }
  }
  return [value];
}

export function layoutFlowLabel(text, source, target, layoutText, zoom = 1) {
  const value = String(text ?? '');
  const geometry = flowLabelGeometry(source, target);
  return {
    ...geometry,
    layoutKey: flowLabelLayoutKey(value, geometry.maxWidth, zoom),
    lineHeight: flowLabelTextMetrics(zoom).lineHeight,
    lines: layoutFlowLabelLines(value, geometry.maxWidth, layoutText, zoom),
  };
}

export function flowLabelFirstLineOffset(lineCount, zoom = 1) {
  return -Math.max(0, Number(lineCount) - 1) * flowLabelTextMetrics(zoom).lineHeight / 2;
}
