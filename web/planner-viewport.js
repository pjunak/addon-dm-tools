/** The preserved planner's fixed ladder always includes a native 100% stop. */
export const zoomLevels = [0.35, 0.45, 0.55, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export function stepZoom(current, direction) {
    const nearest = zoomLevels.reduce((best, level) => Math.abs(level - current) < Math.abs(best - current) ? level : best, 1);
    return zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, zoomLevels.indexOf(nearest) + Math.sign(direction)))];
}
export function fittedZoom(width, height, viewportWidth, viewportHeight) {
    const limit = Math.min(1, Math.max(1, viewportWidth - 48) / Math.max(1, width), Math.max(1, viewportHeight - 48) / Math.max(1, height));
    return [...zoomLevels].reverse().find(level => level <= limit) ?? zoomLevels[0];
}
export function canvasBounds(positions) {
    const points = [...positions];
    const left = Math.min(0, ...points.map(point => point.x - 24)), top = Math.min(0, ...points.map(point => point.y - 24));
    const right = Math.max(480, ...points.map(point => point.x + 240 + 24)), bottom = Math.max(320, ...points.map(point => point.y + 132 + 24));
    return { left, top, width: right - left, height: bottom - top };
}
export function nativePixel(value, scale = globalThis.devicePixelRatio || 1) { return Math.round(value * scale) / scale; }
const en = { canvas: "Story canvas", controls: "Canvas controls", out: "Zoom out", reset: "Reset zoom to 100%", in: "Zoom in", fit: "Fit", focus: "Focus selected", fullscreen: "Fullscreen", exit: "Exit fullscreen", help: "Drag empty canvas to select; middle-drag or Alt-drag pans. Ctrl + wheel or +/− zooms; 0 resets; F fits. Arrows move selected cards; Ctrl + arrows pans." };
const cs = { canvas: "Příběhové plátno", controls: "Ovládání plátna", out: "Oddálit", reset: "Obnovit přiblížení na 100 %", in: "Přiblížit", fit: "Přizpůsobit", focus: "Zaměřit výběr", fullscreen: "Celá obrazovka", exit: "Ukončit celou obrazovku", help: "Tažením prázdného plátna vybíráte; prostřední tlačítko nebo Alt a tažení posouvá pohled. Ctrl + kolečko nebo +/− mění přiblížení; 0 obnoví měřítko; F přizpůsobí. Šipky přesouvají vybrané karty; Ctrl + šipky posouvají pohled." };
export function canvasLabels(host) { return host && typeof host === "object" && "locale" in host && host.locale === "cs" ? cs : en; }
