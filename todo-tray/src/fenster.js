'use strict';
// Gemerkte Größe/Position des großen Fensters prüfen (rein rechnerisch, ohne Electron, daher testbar).
const MIN = { width: 720, height: 480 }, STANDARD = { width: 1100, height: 720 };

const sichtbar = (r, areas) => areas.some(a => r.x < a.x + a.width - 40 && r.x + r.width > a.x + 40 && r.y >= a.y - 10 && r.y < a.y + a.height - 40);

// saved: { x, y, width, height, maximiert } oder undefined; areas: Arbeitsbereiche aller Bildschirme.
function fensterGroesse(saved, areas) {
  const s = saved && Number.isFinite(saved.width) && Number.isFinite(saved.height) ? saved : null;
  const maxA = areas[0] || { x: 0, y: 0, width: 1920, height: 1080 };
  const width = Math.max(MIN.width, Math.min(s ? s.width : STANDARD.width, maxA.width));
  const height = Math.max(MIN.height, Math.min(s ? s.height : STANDARD.height, maxA.height));
  const out = { width, height, maximiert: !!(s && s.maximiert) };
  if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && sichtbar({ x: s.x, y: s.y, width, height }, areas)) { out.x = s.x; out.y = s.y; }
  return out;   // ohne x/y: Electron zentriert das Fenster
}

module.exports = { fensterGroesse, MIN, STANDARD };
