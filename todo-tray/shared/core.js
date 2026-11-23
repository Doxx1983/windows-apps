'use strict';
// Gemeinsame Datenlogik für Windows-App (Node) und Handy-PWA (Browser): Aufgabenformat, Status, Patches.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TodoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS = ['todo', 'doing', 'done'];
  const FIELDS = ['titel', 'notiz', 'status', 'erledigt', 'erledigtAm', 'archiviert', 'heute', 'zuordnung', 'zugewiesenAn', 'faellig', 'ablegen', 'ablage', 'abhaengigVon', 'schritte'];
  const ID_RE = /^[a-z0-9-]+$/;

  const now = () => new Date().toISOString();
  const newId = () => {
    const a = new Uint8Array(3); globalThis.crypto.getRandomValues(a);
    return Date.now().toString(36) + '-' + [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Listen-Felder: früher war "zugewiesenAn" ein einzelner Name (oder null), jetzt eine Liste.
  const namen = v => [...new Set((Array.isArray(v) ? v : (v ? [v] : [])).map(x => String(x).trim()).filter(Boolean))];
  const idListe = (v, self) => [...new Set((Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && ID_RE.test(x) && x !== self))];
  const schrittListe = v => (Array.isArray(v) ? v : []).filter(x => x && typeof x.titel === 'string' && x.titel.trim())
    .map(x => ({ id: typeof x.id === 'string' && x.id ? x.id : newId(), titel: x.titel.trim(), erledigt: !!x.erledigt }));

  // Altbestand ohne Status/Listen ergänzen.
  function normalize(t) {
    if (!STATUS.includes(t.status)) t.status = t.erledigt ? 'done' : 'todo';
    t.zugewiesenAn = namen(t.zugewiesenAn);
    t.abhaengigVon = idListe(t.abhaengigVon, t.id);
    t.schritte = schrittListe(t.schritte);
    return t;
  }

  function createTask({ titel, zuordnung = null, heute = null, notiz = '', zugewiesenAn = [], faellig = null, status = 'todo' }, user) {
    const st = STATUS.includes(status) ? status : 'todo';
    return {
      id: newId(), titel: String(titel).trim(), notiz, status: st, erledigt: st === 'done', erledigtAm: st === 'done' ? now() : null,
      archiviert: false, heute, zuordnung, zugewiesenAn: namen(zugewiesenAn), faellig, ablegen: false, ablage: null, abhaengigVon: [], schritte: [],
      erstelltVon: user, erstelltAm: now(), geaendertVon: user, geaendertAm: now(),
    };
  }

  // Patch statt Komplett-Überschreiben: nur geänderte Felder ersetzen; status und erledigt bleiben im Gleichschritt.
  function applyPatch(task, patch, user) {
    const t = normalize({ ...task }), p = { ...patch };
    if ('status' in p && !STATUS.includes(p.status)) delete p.status;
    if ('status' in p) p.erledigt = p.status === 'done';
    else if ('erledigt' in p) p.status = p.erledigt ? 'done' : 'todo';
    if ('erledigt' in p && !('erledigtAm' in p)) p.erledigtAm = p.erledigt ? now() : null;
    if ('zugewiesenAn' in p) p.zugewiesenAn = namen(p.zugewiesenAn);
    if ('abhaengigVon' in p) p.abhaengigVon = idListe(p.abhaengigVon, t.id);
    if ('schritte' in p) p.schritte = schrittListe(p.schritte);
    for (const k of FIELDS) if (k in p) t[k] = p[k];
    if (typeof t.titel !== 'string' || !t.titel.trim()) throw new Error('Titel fehlt');
    t.geaendertVon = user; t.geaendertAm = now();
    return t;
  }

  // ----- Abhängigkeiten ("wartet auf") und Teilschritte -----
  // Voraussetzungen, die noch nicht erledigt sind (fehlende/gelöschte Aufgaben zählen nicht).
  const offeneVoraussetzungen = (t, alle) => (t.abhaengigVon || []).map(id => alle.find(x => x.id === id)).filter(x => x && x.status !== 'done');
  // Würde "t hängt von dep ab" einen Kreis ergeben (dep hängt direkt/indirekt schon von t ab)?
  function bildetZyklus(taskId, depId, alle) {
    const gesehen = new Set(), stapel = [depId];
    while (stapel.length) {
      const id = stapel.pop();
      if (id === taskId) return true;
      if (gesehen.has(id)) continue; gesehen.add(id);
      const x = alle.find(a => a.id === id); if (x) stapel.push(...(x.abhaengigVon || []));
    }
    return false;
  }
  // Regeln, die nur mit Blick auf alle Aufgaben prüfbar sind. Wirft bei Verstoß (Speicher und Oberfläche nutzen es).
  function pruefePatch(patch, task, alle) {
    const wirdFertig = ('status' in patch && patch.status === 'done') || patch.erledigt === true;
    if (wirdFertig && task.status !== 'done') {
      const offen = offeneVoraussetzungen(task, alle);
      if (offen.length) throw new Error('Wartet noch auf: ' + offen.map(x => x.titel).join(', '));
    }
    if ('abhaengigVon' in patch) {
      for (const id of idListe(patch.abhaengigVon, task.id)) if (bildetZyklus(task.id, id, alle)) throw new Error('Abhängigkeit würde einen Kreis ergeben');
    }
  }
  const schrittFortschritt = t => ({ fertig: (t.schritte || []).filter(s => s.erledigt).length, gesamt: (t.schritte || []).length });

  // ----- Projekte / Chats mit Mitgliederliste (leer = alle). Nur Sichtbarkeit in der App, kein technischer Schutz. -----
  const normNamen = a => [...new Set((Array.isArray(a) ? a : []).map(x => String(x).trim()).filter(Boolean))];
  function newProject({ name, typ = 'projekt', mitglieder = [] }, user) {
    const m = normNamen(mitglieder); if (m.length && !m.includes(user)) m.push(user);
    return { id: newId(), name: String(name).trim(), typ: typ === 'chat' ? 'chat' : 'projekt', besitzer: user, mitglieder: m };
  }
  const kannProjektBearbeiten = (p, user) => !p.besitzer || p.besitzer === user;
  function applyProjectPatch(p, patch, user) {
    if (!kannProjektBearbeiten(p, user)) throw new Error('Nur ' + p.besitzer + ' darf „' + p.name + '“ ändern');
    const x = { ...p };
    if ('name' in patch && String(patch.name).trim()) x.name = String(patch.name).trim();
    if ('typ' in patch) x.typ = patch.typ === 'chat' ? 'chat' : 'projekt';
    if ('mitglieder' in patch) { const m = normNamen(patch.mitglieder); if (m.length && x.besitzer && !m.includes(x.besitzer)) m.push(x.besitzer); x.mitglieder = m; }
    return x;
  }
  const projektSichtbar = (p, name) => !Array.isArray(p.mitglieder) || !p.mitglieder.length || p.mitglieder.includes(name);
  // Blendet Projekte und deren Aufgaben aus, bei denen `name` nicht Mitglied ist. Aufgaben ohne Projekt sind für alle sichtbar.
  function filterSichtbar(d, name) {
    const versteckt = new Set(d.projekte.filter(p => !projektSichtbar(p, name)).map(p => p.id));
    return { ...d, projekte: d.projekte.filter(p => !versteckt.has(p.id)), aufgaben: d.aufgaben.filter(t => !t.zuordnung || !versteckt.has(t.zuordnung)) };
  }
  // Wer darf bei diesem Projekt zuständig sein?
  function werFuer(projekte, projektId, nutzer) {
    const p = projekte.find(x => x.id === projektId);
    return p && Array.isArray(p.mitglieder) && p.mitglieder.length ? p.mitglieder : nutzer;
  }

  return { namen, offeneVoraussetzungen, bildetZyklus, pruefePatch, schrittFortschritt, newProject, kannProjektBearbeiten, applyProjectPatch, projektSichtbar, filterSichtbar, werFuer, STATUS, FIELDS, ID_RE, now, newId, normalize, createTask, applyPatch };
});
