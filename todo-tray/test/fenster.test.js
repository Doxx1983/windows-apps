'use strict';
const assert = require('assert');
const { fensterGroesse, MIN, STANDARD } = require('../src/fenster');
const A = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const B = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1280, height: 1024 }];

// Erster Start: Standardgröße, zentriert (kein x/y)
assert.deepStrictEqual(fensterGroesse(undefined, A), { width: STANDARD.width, height: STANDARD.height, maximiert: false });
// Gemerkte Größe und Position bleiben erhalten
assert.deepStrictEqual(fensterGroesse({ x: 100, y: 50, width: 1000, height: 700, maximiert: true }, A), { width: 1000, height: 700, maximiert: true, x: 100, y: 50 });
// Zweiter Bildschirm ist da -> Position erlaubt; ist er weg (Laptop ohne Monitor) -> Position wird verworfen
const saved = { x: 2100, y: 40, width: 900, height: 600 };
assert.strictEqual(fensterGroesse(saved, B).x, 2100);
assert.ok(!('x' in fensterGroesse(saved, A)));
// Zu klein/zu groß/kaputt
assert.strictEqual(fensterGroesse({ width: 100, height: 100 }, A).width, MIN.width);
assert.strictEqual(fensterGroesse({ width: 9999, height: 9999 }, A).width, 1920);
assert.deepStrictEqual(fensterGroesse({ width: 'x' }, A), { width: STANDARD.width, height: STANDARD.height, maximiert: false });
console.log('Fenster-Tests OK');
