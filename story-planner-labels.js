import { flowLabelGeometry } from './story-planner-model.js';

export const FLOW_LABEL_FONT = '12px Inter, sans-serif';
export const FLOW_LABEL_LINE_HEIGHT = 16;
const FLOW_LABEL_WIDTH_STEP = 0.5;

export function flowLabelLayoutWidth(maxWidth) {
  const value = Number(maxWidth);
  if (!Number.isFinite(value) || value <= 0) return FLOW_LABEL_WIDTH_STEP;
  return Math.max(FLOW_LABEL_WIDTH_STEP, Math.round(value / FLOW_LABEL_WIDTH_STEP) * FLOW_LABEL_WIDTH_STEP);
}

export function flowLabelLayoutKey(text, maxWidth) {
  return JSON.stringify([String(text ?? ''), flowLabelLayoutWidth(maxWidth)]);
}

export function layoutFlowLabelLines(text, maxWidth, layoutText) {
  const value = String(text ?? '');
  if (!value) return [];
  if (typeof layoutText === 'function') {
    try {
      const result = layoutText(value, {
        font: FLOW_LABEL_FONT,
        maxWidth: flowLabelLayoutWidth(maxWidth),
        lineHeight: FLOW_LABEL_LINE_HEIGHT,
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

export function layoutFlowLabel(text, source, target, layoutText) {
  const value = String(text ?? '');
  const geometry = flowLabelGeometry(source, target);
  return {
    ...geometry,
    layoutKey: flowLabelLayoutKey(value, geometry.maxWidth),
    lines: layoutFlowLabelLines(value, geometry.maxWidth, layoutText),
  };
}

export function flowLabelFirstLineOffset(lineCount) {
  return -Math.max(0, Number(lineCount) - 1) * FLOW_LABEL_LINE_HEIGHT / 2;
}
