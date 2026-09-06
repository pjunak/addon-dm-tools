/** The preserved planner's fixed ladder always includes a native 100% stop. */
export const zoomLevels = [0.35, 0.45, 0.55, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export function stepZoom(current: number, direction: number): number {
  const nearest = zoomLevels.reduce<number>((best, level) => Math.abs(level - current) < Math.abs(best - current) ? level : best, 1);
  return zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, zoomLevels.indexOf(nearest as typeof zoomLevels[number]) + Math.sign(direction)))]!;
}
export function fittedZoom(width: number, height: number, viewportWidth: number, viewportHeight: number): number {
  const limit = Math.min(1, Math.max(1, viewportWidth - 48) / Math.max(1, width), Math.max(1, viewportHeight - 48) / Math.max(1, height));
  return [...zoomLevels].reverse().find(level => level <= limit) ?? zoomLevels[0];
}
export interface CanvasView { zoom: number; x: number; y: number }
export interface CanvasPoint { x: number; y: number }
export function canvasBounds(positions: Iterable<CanvasPoint>) {
  const points = [...positions];
  const left = Math.min(0, ...points.map(point => point.x - 24)), top = Math.min(0, ...points.map(point => point.y - 24));
  const right = Math.max(480, ...points.map(point => point.x + 240 + 24)), bottom = Math.max(320, ...points.map(point => point.y + 132 + 24));
  return { left, top, width: right - left, height: bottom - top };
}
export function nativePixel(value: number, scale = globalThis.devicePixelRatio || 1): number { return Math.round(value * scale) / scale; }

const en = { canvas: "Story canvas", controls: "Canvas controls", out: "Zoom out", reset: "Reset zoom to 100%", in: "Zoom in", fit: "Fit", focus: "Focus selected", fullscreen: "Fullscreen", exit: "Exit fullscreen", help: "Drag empty canvas to pan. Ctrl + wheel or +/− zooms; 0 resets; F fits; arrow keys pan." };
const cs: typeof en = { canvas: "Příběhové plátno", controls: "Ovládání plátna", out: "Oddálit", reset: "Obnovit přiblížení na 100 %", in: "Přiblížit", fit: "Přizpůsobit", focus: "Zaměřit výběr", fullscreen: "Celá obrazovka", exit: "Ukončit celou obrazovku", help: "Tažením prázdného plátna posouváte pohled. Ctrl + kolečko nebo +/− mění přiblížení; 0 obnoví měřítko; F přizpůsobí; šipky posouvají." };
export function canvasLabels(host: unknown): typeof en { return host && typeof host === "object" && "locale" in host && host.locale === "cs" ? cs : en; }
