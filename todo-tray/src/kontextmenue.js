'use strict';
// Rechtsklick-Menü: in Eingabefeldern Ausschneiden/Kopieren/Einfügen, bei markiertem Text Kopieren (rein rechnerisch, daher testbar).
function menuVorlage(p) {
  const f = p.editFlags || {};
  if (p.isEditable) {
    return [
      { label: 'Ausschneiden', role: 'cut', enabled: !!f.canCut },
      { label: 'Kopieren', role: 'copy', enabled: !!f.canCopy },
      { label: 'Einfügen', role: 'paste', enabled: !!f.canPaste },
    ];
  }
  if (p.selectionText && p.selectionText.trim()) return [{ label: 'Kopieren', role: 'copy' }];
  return [];
}
module.exports = { menuVorlage };
