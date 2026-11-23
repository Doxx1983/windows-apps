'use strict';
const assert = require('assert');
const { menuVorlage } = require('../src/kontextmenue');
const namen = v => v.map(x => x.label + (x.enabled === false ? '(aus)' : ''));
// Eingabefeld ohne Auswahl: Kopieren/Ausschneiden ausgegraut, Einfügen nur mit Inhalt in der Zwischenablage
assert.deepStrictEqual(namen(menuVorlage({ isEditable: true, editFlags: { canCut: false, canCopy: false, canPaste: true } })), ['Ausschneiden(aus)', 'Kopieren(aus)', 'Einfügen']);
// Eingabefeld mit Auswahl
assert.deepStrictEqual(namen(menuVorlage({ isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true } })), ['Ausschneiden', 'Kopieren', 'Einfügen']);
assert.deepStrictEqual(menuVorlage({ isEditable: true, editFlags: { canPaste: true } }).map(x => x.role), ['cut', 'copy', 'paste']);
// Markierter Text außerhalb von Eingabefeldern: nur Kopieren
assert.deepStrictEqual(namen(menuVorlage({ isEditable: false, selectionText: 'Garn bestellen' })), ['Kopieren']);
// Sonst kein Menü
assert.deepStrictEqual(menuVorlage({ isEditable: false, selectionText: '  ' }), []);
assert.deepStrictEqual(menuVorlage({}), []);
console.log('Kontextmenü-Tests OK');
