import { flowLabelGeometry } from './story-planner-model.js';

export const FLOW_LABEL_FONT = '12px Inter, sans-serif';
export const FLOW_LABEL_LINE_HEIGHT = 16;

export function layoutFlowLabel(text, source, target, layoutText) {
  const value = String(text ?? '');
  const geometry = flowLabelGeometry(source, target);
  if (!value) return { ...geometry, lines: [] };
  if (typeof layoutText === 'function') {
    try {
      const result = layoutText(value, {
        font: FLOW_LABEL_FONT,
        maxWidth: geometry.maxWidth,
        lineHeight: FLOW_LABEL_LINE_HEIGHT,
      });
      const lines = (result?.lines || [])
        .map(line => String(line?.text ?? ''))
        .filter(Boolean);
      if (lines.length) return { ...geometry, lines };
    } catch {
      // Older or partially compatible hosts keep the previous single-line label.
    }
  }
  return { ...geometry, lines: [value] };
}

export function flowLabelFirstLineOffset(lineCount) {
  return -Math.max(0, Number(lineCount) - 1) * FLOW_LABEL_LINE_HEIGHT / 2;
}
