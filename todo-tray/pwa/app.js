'use strict';
const $ = id => document.getElementById(id);
const Core = window.TodoCore;
const THEMES = ['auto', 'light', 'dark'], T_ICON = { auto: '🌓', light: '☀️', dark: '🌙' }, T_NAME = { auto: 'automatisch', light: 'hell', dark: 'dunkel' };
let theme = 'auto'; try { theme = localStorage.getItem('theme') || 'auto'; } catch { /* ok */ }
function applyTheme(t) {
  theme = THEMES.includes(t) ? t : 'auto';
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = theme;
  $('bTheme').textContent = T_ICON[theme]; $('bTheme').title = 'Design: ' + T_NAME[theme] + ' (Klick wechselt)';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = getComputedStyle(document.body).backgroundColor;
  try { localStorage.setItem('theme', theme); } catch { /* ok */ }
}
$('bTheme').onclick = () => applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % 3]);
applyTheme(theme);
$('datum').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const CFG = window.TODO_CONFIG || {};
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ok */ } } };
const heuteStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

let me = ls.get('nutzer') || '', data = { aufgaben: [], projekte: [], nutzer: [], eingang: [] }, bereit = false;
let ansicht = 'heute', filter = '', filterWer = '', neuHeute = false, detailId = null, detailFiles = [], bekannt = null, busy = false;

const ANSICHTEN = [['heute', 'Heute'], ['offen', 'Offen'], ['board', 'Board'], ['erledigt', 'Erledigt'], ['archiv', 'Archiv']];
const SPALTEN = [['todo', 'Zu tun'], ['doing', 'In Arbeit'], ['done', 'Fertig']];
const istHeute = t => t.heute === heuteStr();
const passt = {
  heute: t => !t.archiviert && istHeute(t), offen: t => !t.archiviert && t.status !== 'done', board: t => !t.archiviert,
  erledigt: t => !t.archiviert && t.status === 'done', archiv: t => t.archiviert,
};
const zuOk = t => filter === '' || (filter === '-' ? !t.zuordnung : t.zuordnung === filter);
const werOk = t => filterWer === '' || (filterWer === '-' ? !t.zugewiesenAn.length : t.zugewiesenAn.includes(filterWer));
const sichtbar = k => data.aufgaben.filter(passt[k]).filter(zuOk).filter(werOk);
const finde = id => data.aufgaben.find(t => t.id === id);

function el(tag, props = {}, ...kids) { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; }
let toastT; function toast(msg, ms = 2500) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); if (ms) toastT = setTimeout(() => { t.hidden = true; }, ms); }

// Fehler abfangen: Anmeldung abgelaufen -> Anmeldeseite, sonst Hinweis.
async function run(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.message === 'AUTH') { zeige('pLogin'); $('loginErr').textContent = 'Anmeldung abgelaufen, bitte erneut anmelden.'; }
    else toast('Fehler: ' + e.message, 6000);
  }
}
const zeige = id => { for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id; };
const schliesse = () => { for (const p of document.querySelectorAll('.panel')) p.hidden = true; };

const projName = id => { const p = data.projekte.find(x => x.id === id); return p ? (p.typ === 'chat' ? '💬 ' : '📁 ') + p.name : null; };
const datumKurz = s => { const [, m, d] = s.split('-'); return d + '.' + m + '.'; };
function faelligTag(t) {
  if (!t.faellig) return null;
  const spaet = t.status !== 'done' && t.faellig < heuteStr();
  return el('span', { className: 'tag due' + (spaet ? ' late' : ''), textContent: '⏰ ' + (t.faellig === heuteStr() ? 'heute fällig' : (spaet ? 'überfällig ' : 'fällig ') + datumKurz(t.faellig)) });
}
function nutzerListe() { return [...new Set([...(data.nutzer || []), me].filter(Boolean))]; }
function optProj(sel, leer, aktuell) {
  sel.replaceChildren(el('option', { value: '', textContent: leer }), ...data.projekte.map(p => el('option', { value: p.id, textContent: projName(p.id) })));
  sel.value = [...sel.options].some(o => o.value === aktuell) ? aktuell : '';
}
function optWer(sel, mitAlle, aktuell, projektId) {
  sel.replaceChildren(el('option', { value: '', textContent: mitAlle ? 'Zuständig: alle' : 'Niemand' }),
    ...(projektId ? Core.werFuer(data.projekte, projektId, nutzerListe()) : nutzerListe()).map(n => el('option', { value: n, textContent: n === me ? n + ' (ich)' : n })));
  if (mitAlle) sel.append(el('option', { value: '-', textContent: 'Niemand' }));
  sel.value = [...sel.options].some(o => o.value === aktuell) ? aktuell : (mitAlle ? '' : me);
}
const sortiere = (a, b) => ((a.status === 'done') - (b.status === 'done')) || (a.faellig || '9999').localeCompare(b.faellig || '9999') || (b.erstelltAm || '').localeCompare(a.erstelltAm || '');

// Abhängigkeiten werden gegen ALLE Aufgaben geprüft (auch gegen solche aus Projekten, die ich nicht sehe).
const alle = () => data.alle || data.aufgaben;
const voraussetzungen = t => (t.status === 'done' ? [] : Core.offeneVoraussetzungen(t, alle()));
const sichtName = id => { const x = data.aufgaben.find(a => a.id === id); return x ? x.titel : '🔒 (nicht sichtbar)'; };

function metaEl(t) {
  const m = el('div', { className: 'meta' });
  if (t.status === 'doing') m.append(el('span', { className: 'tag', textContent: 'In Arbeit' }));
  const f = faelligTag(t); if (f) m.append(f);
  const pn = projName(t.zuordnung); if (pn) m.append(el('span', { className: 'tag', textContent: pn }));
  const offen = voraussetzungen(t);
  if (offen.length) m.append(el('span', { className: 'tag blk', textContent: '🔒 wartet auf ' + offen.map(x => sichtName(x.id)).join(', ') }));
  if (t.zugewiesenAn.length) m.append(el('span', { className: 'tag wer', textContent: '→ ' + t.zugewiesenAn.join(', ') }));
  const fp = Core.schrittFortschritt(t); if (fp.gesamt) m.append(el('span', { textContent: '☑ ' + fp.fertig + '/' + fp.gesamt }));
  if (t.ablegen) m.append(el('span', { className: 'tag', textContent: '🗂 vormerken' }));
  if (t.dateienAnzahl) m.append(el('span', { textContent: '📎 ' + t.dateienAnzahl }));
  if (t.erstelltVon && t.erstelltVon !== me) m.append(el('span', { textContent: 'von ' + t.erstelltVon }));
  return m;
}
function taskEl(t) {
  const done = t.status === 'done';
  const sperre = voraussetzungen(t);
  const box = el('button', { className: 'box' + (sperre.length ? ' gesperrt' : ''), textContent: done ? '✓' : (sperre.length ? '🔒' : (t.status === 'doing' ? '…' : '')),
    onclick: e => { e.stopPropagation(); if (sperre.length) return toast('Wartet noch auf: ' + sperre.map(x => sichtName(x.id)).join(', '), 4000); aendern(t.id, { status: done ? 'todo' : 'done' }); } });
  const row = el('div', { className: 'task ' + t.status, onclick: () => oeffneDetail(t.id) }, box, el('div', { className: 'txt' }, el('div', { className: 't', textContent: t.titel }), metaEl(t)));
  if (!t.archiviert) row.append(el('button', { className: 'heute' + (istHeute(t) ? ' on' : ''), textContent: istHeute(t) ? '★' : '☆', onclick: e => { e.stopPropagation(); aendern(t.id, { heute: istHeute(t) ? null : heuteStr() }); } }));
  return row;
}
function cardEl(t) {
  const i = SPALTEN.findIndex(s => s[0] === t.status), act = el('div', { className: 'act' });
  act.append(i > 0 ? el('button', { textContent: '◀ ' + SPALTEN[i - 1][1], onclick: e => { e.stopPropagation(); aendern(t.id, { status: SPALTEN[i - 1][0] }); } }) : el('span'));
  if (i < 2) act.append(el('button', { textContent: SPALTEN[i + 1][1] + ' ▶', disabled: SPALTEN[i + 1][0] === 'done' && voraussetzungen(t).length > 0, onclick: e => { e.stopPropagation(); aendern(t.id, { status: SPALTEN[i + 1][0] }); } }));
  return el('div', { className: 'card ' + t.status, onclick: () => oeffneDetail(t.id) }, el('div', { className: 't', textContent: t.titel }), metaEl(t), act);
}

function render() {
  if (!bereit) return;
  const nav = $('nav'); nav.replaceChildren();
  for (const [k, l] of ANSICHTEN) nav.append(el('button', { className: k === ansicht ? 'on' : '', onclick: () => { ansicht = k; render(); } }, l + ' ', el('small', { textContent: sichtbar(k).length })));
  optProj($('filter'), 'Alle Zuordnungen', filter); filter = $('filter').value;
  optWer($('filterWer'), true, filterWer); filterWer = $('filterWer').value;
  optProj($('neuZu'), 'Ohne Zuordnung', $('neuZu').value);
  optWer($('neuWer'), false, $('neuWer').dataset.gewaehlt ?? me, $('neuZu').value);
  $('neuHeute').className = 'star' + (neuHeute ? ' on' : '');
  const board = ansicht === 'board'; $('liste').hidden = board; $('board').hidden = !board;
  if (board) {
    const liste = sichtbar('board').sort(sortiere), b = $('board'); b.replaceChildren();
    for (const [st, name] of SPALTEN) { const items = liste.filter(t => t.status === st); b.append(el('div', { className: 'col' }, el('h3', {}, el('span', { textContent: name }), el('span', { textContent: items.length })), el('div', { className: 'cards' }, ...items.map(cardEl)))); }
  } else {
    const liste = sichtbar(ansicht).sort(sortiere), main = $('liste'); main.replaceChildren();
    if (!liste.length) main.append(el('p', { className: 'leer', textContent: { heute: 'Nichts für heute markiert.', offen: 'Alles erledigt 🎉', erledigt: 'Noch nichts erledigt.', archiv: 'Archiv ist leer.' }[ansicht] }));
    for (const t of liste) main.append(taskEl(t));
  }
  const n = data.eingang.length; $('inN').hidden = !n; $('inN').textContent = n;
  if (!$('pIn').hidden) renderEingang();
  if (detailId && !$('pTask').hidden) refreshDetail();
}

function pruefeNeueZuweisungen() {
  const meine = new Set(data.aufgaben.filter(t => t.zugewiesenAn.includes(me) && t.status !== 'done' && !t.archiviert).map(t => t.id));
  if (bekannt) for (const id of meine) if (!bekannt.has(id)) { const t = finde(id); if (t && t.geaendertVon !== me) toast('Neue Aufgabe von ' + t.geaendertVon + ': ' + t.titel, 6000); }
  bekannt = meine;
}
async function laden() { if (!bereit || busy) return; busy = true; try { await run(async () => { const roh = await Drive.load(); data = Core.filterSichtbar(roh, me); data.alle = roh.aufgaben; pruefeNeueZuweisungen(); render(); }); } finally { busy = false; } }
async function aendern(id, patch) { await run(async () => { await Drive.update(id, patch); }); await laden(); }

// ---------- Details ----------
async function oeffneDetail(id) {
  const t = finde(id); if (!t) return;
  detailId = id; detailFiles = []; $('dTitel').value = t.titel; $('dNotiz').value = t.notiz || '';
  zeige('pTask'); refreshDetail();
  await run(async () => { detailFiles = await Drive.taskFiles(id); if (detailId === id) refreshDetail(); });
}
function refreshDetail() {
  const t = finde(detailId); if (!t) { detailId = null; return schliesse(); }
  $('dStatus').value = t.status; $('dFaellig').value = t.faellig || ''; $('dHeute').checked = istHeute(t);
  optProj($('dZu'), 'Ohne Zuordnung', t.zuordnung || '');
  $('dAblegen').checked = !!t.ablegen; $('dAblage').textContent = t.ablage ? 'Dateien abgelegt in: ' + t.ablage : '';
  $('dInfo').textContent = 'Angelegt von ' + t.erstelltVon + ', zuletzt geändert von ' + t.geaendertVon + '.';
  $('dArch').textContent = t.archiviert ? 'Zurückholen' : 'Archivieren';
  // Zuständige: Mehrfachauswahl, nur Mitglieder des Projekts (bereits Zugewiesene bleiben sichtbar)
  const wer = $('dWer'); wer.replaceChildren();
  for (const n of new Set([...Core.werFuer(data.projekte, t.zuordnung, nutzerListe()), ...t.zugewiesenAn])) {
    const an = t.zugewiesenAn.includes(n);
    wer.append(el('button', { type: 'button', className: 'chip' + (an ? ' on' : ''), textContent: (an ? '✓ ' : '') + (n === me ? n + ' (ich)' : n),
      onclick: () => aendern(t.id, { zugewiesenAn: an ? t.zugewiesenAn.filter(x => x !== n) : [...t.zugewiesenAn, n] }) }));
  }
  // Abhängigkeiten
  const dep = $('dDep'); dep.replaceChildren();
  if (!t.abhaengigVon.length) dep.append(el('span', { className: 'hint', textContent: 'Keine' }));
  for (const id of t.abhaengigVon) {
    const x = alle().find(a => a.id === id);
    dep.append(el('button', { type: 'button', className: 'chip on x', textContent: (x && x.status === 'done' ? '✓ ' : '⏳ ') + sichtName(id),
      onclick: () => aendern(t.id, { abhaengigVon: t.abhaengigVon.filter(y => y !== id) }) }));
  }
  const kand = data.aufgaben.filter(a => a.id !== t.id && !t.abhaengigVon.includes(a.id) && !a.archiviert && !Core.bildetZyklus(t.id, a.id, alle()));
  $('dDepAdd').replaceChildren(el('option', { value: '', textContent: 'Wartet auf … (Aufgabe hinzufügen)' }), ...kand.map(a => el('option', { value: a.id, textContent: a.titel })));
  const offen = voraussetzungen(t);
  $('dBlock').textContent = offen.length ? '🔒 Kann erst abgeschlossen werden, wenn erledigt: ' + offen.map(x => sichtName(x.id)).join(', ') : '';
  $('dStatus').querySelector('option[value=done]').disabled = offen.length > 0;
  // Teilschritte
  const sb = $('dSchritte'); sb.replaceChildren();
  const setze = liste => aendern(t.id, { schritte: liste });
  for (const st of t.schritte) {
    sb.append(el('div', { className: 'step' + (st.erledigt ? ' done' : '') },
      el('input', { type: 'checkbox', checked: st.erledigt, onchange: e => setze(t.schritte.map(x => (x.id === st.id ? { ...x, erledigt: e.target.checked } : x))) }),
      el('span', { textContent: st.titel, style: 'flex:1' }),
      el('button', { type: 'button', textContent: '🗑', onclick: () => setze(t.schritte.filter(x => x.id !== st.id)) })));
  }
  const fp = Core.schrittFortschritt(t); $('dFort').textContent = fp.gesamt ? ' (' + fp.fertig + '/' + fp.gesamt + ')' : '';
  const box = $('dDateien'); box.replaceChildren();
  if (!detailFiles.length) box.append(el('p', { className: 'hint', textContent: 'Noch keine Dateien.' }));
  for (const f of detailFiles) box.append(el('div', { className: 'pl' }, el('span', { textContent: '📎 ' + f.name }),
    el('button', { textContent: '↗', onclick: () => window.open(f.link, '_blank', 'noopener') }),
    el('button', { textContent: '🗑', onclick: async () => { if (confirm('Datei „' + f.name + '“ in den Papierkorb?')) await run(async () => { await Drive.trash(f.id); detailFiles = await Drive.taskFiles(detailId); refreshDetail(); }); } })));
}
const feld = (id, key, wert) => { $(id).onchange = () => aendern(detailId, { [key]: wert($(id)) }); };
feld('dStatus', 'status', e => e.value); feld('dFaellig', 'faellig', e => e.value || null);
$('dDepAdd').onchange = () => { const v = $('dDepAdd').value; if (v) aendern(detailId, { abhaengigVon: [...finde(detailId).abhaengigVon, v] }); };
const schrittNeu = () => { const v = $('dSchrittNeu').value.trim(); if (!v) return; $('dSchrittNeu').value = ''; aendern(detailId, { schritte: [...finde(detailId).schritte, { titel: v, erledigt: false }] }); };
$('dSchrittAdd').onclick = schrittNeu; $('dSchrittNeu').onkeydown = e => { if (e.key === 'Enter') schrittNeu(); };
feld('dAblegen', 'ablegen', e => e.checked); feld('dZu', 'zuordnung', e => e.value || null); feld('dHeute', 'heute', e => e.checked ? heuteStr() : null);
$('dTitel').onchange = () => { const v = $('dTitel').value.trim(); if (v) aendern(detailId, { titel: v }); else $('dTitel').value = finde(detailId).titel; };
$('dNotiz').onchange = () => aendern(detailId, { notiz: $('dNotiz').value });
$('dFoto').onclick = () => $('fFoto').click(); $('dAdd').onclick = () => $('fDatei').click();
for (const id of ['fFoto', 'fDatei']) $(id).onchange = async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  toast('Lade hoch …', 0);
  await run(async () => { detailFiles = await Drive.addFiles(detailId, files); toast('Hochgeladen ✓'); refreshDetail(); });
  await laden();
};
$('dOk').onclick = () => { detailId = null; schliesse(); };
$('dArch').onclick = async () => { const t = finde(detailId); await aendern(detailId, { archiviert: !t.archiviert }); detailId = null; schliesse(); };

// ---------- Eingang ----------
function renderEingang() {
  const box = $('inListe'); box.replaceChildren();
  if (!data.eingang.length) box.append(el('p', { className: 'hint', textContent: 'Eingang ist leer.' }));
  const offene = data.aufgaben.filter(t => !t.archiviert && t.status !== 'done');
  for (const f of data.eingang) {
    const sel = el('select', {}, el('option', { value: '', textContent: 'Aufgabe wählen …' }), ...offene.map(t => el('option', { value: t.id, textContent: t.titel })));
    box.append(el('div', { className: 'pl' }, el('span', { textContent: '📎 ' + f.name }),
      el('button', { textContent: '↗', onclick: () => window.open(f.link, '_blank', 'noopener') }),
      el('button', { textContent: '🗑', onclick: async () => { if (confirm('„' + f.name + '“ in den Papierkorb?')) { await run(() => Drive.trash(f.id)); await laden(); } } }),
      el('div', { className: 'r', style: 'flex:1 0 100%' }, sel,
        el('button', { className: 'go', textContent: 'Zuordnen', onclick: async () => { if (sel.value) { await run(() => Drive.assignInbox(f.id, sel.value)); await laden(); } } }),
        el('button', { className: 'ghost', textContent: 'Neue Aufgabe', onclick: async () => { await run(() => Drive.inboxNewTask(f, { zugewiesenAn: [me] })); await laden(); } }))));
  }
}
$('bIn').onclick = () => { renderEingang(); zeige('pIn'); };
$('inOk').onclick = schliesse; $('inFoto').onclick = () => $('fIn').click();
$('fIn').onchange = async e => { const files = [...e.target.files]; e.target.value = ''; if (!files.length) return; toast('Lade hoch …', 0); await run(async () => { await Drive.addToInbox(files); toast('Im Eingang ✓'); }); await laden(); };

// ---------- Projekte, Einstellungen ----------
function renderProj() {
  const box = $('projListe'); box.replaceChildren();
  if (!data.projekte.length) box.append(el('p', { className: 'hint', textContent: 'Noch keine Einträge.' }));
  for (const p of data.projekte) {
    const darf = Core.kannProjektBearbeiten(p, me), alle = nutzerListe(), begrenzt = p.mitglieder && p.mitglieder.length;
    const editor = el('div', { className: 'r', style: 'flex:1 0 100%;flex-wrap:wrap;gap:12px' }); editor.hidden = true;
    for (const n of alle) {
      const cb = el('input', { type: 'checkbox', checked: !begrenzt || p.mitglieder.includes(n), disabled: n === p.besitzer, style: 'width:auto' });
      cb.onchange = async () => {
        const gewaehlt = [...editor.querySelectorAll('input')].filter(x => x.checked).map(x => x.dataset.n);
        await run(() => Drive.updateProject(p.id, { mitglieder: gewaehlt.length === alle.length ? [] : gewaehlt })); await laden(); renderProj();
      };
      cb.dataset.n = n; editor.append(el('label', { style: 'flex-direction:row;gap:6px;align-items:center;font-weight:700' }, cb, n));
    }
    const row = el('div', { className: 'pl' }, el('span', { textContent: projName(p.id) }), el('span', { className: 'hint', textContent: begrenzt ? '👥 ' + p.mitglieder.join(', ') : '👥 alle' }));
    if (darf) {
      row.append(el('button', { textContent: '👥', onclick: () => { editor.hidden = !editor.hidden; } }),
        el('button', { textContent: '🗑', onclick: async () => { await run(() => Drive.removeProject(p.id)); await laden(); renderProj(); } }), editor);
    } else row.append(el('span', { className: 'hint', textContent: 'von ' + p.besitzer }));
    box.append(row);
  }
}
$('bProj').onclick = () => { renderProj(); zeige('pProj'); }; $('pOk').onclick = () => { schliesse(); render(); };
$('pAdd').onclick = async () => { const name = $('pNameIn').value.trim(); if (!name) return; await run(() => Drive.addProject({ name, typ: $('pTyp').value })); $('pNameIn').value = ''; await laden(); renderProj(); };
$('bSet').onclick = () => { $('setName').textContent = me; $('setInfo').textContent = 'Ordner: ' + CFG.ordner; zeige('pSet'); };
$('setOk').onclick = schliesse; $('setWechsel').onclick = () => zeigeName(); $('setLogin').onclick = () => anmelden();
$('bRef').onclick = () => { toast('Aktualisiere …', 1200); laden(); };

// ---------- Neue Aufgabe ----------
$('add').onsubmit = async e => {
  e.preventDefault(); const titel = $('neuTitel').value.trim(); if (!titel) return;
  await run(() => Drive.create({ titel, zuordnung: $('neuZu').value || null, zugewiesenAn: $('neuWer').value ? [$('neuWer').value] : [], faellig: $('neuFaellig').value || null, heute: neuHeute || ansicht === 'heute' ? heuteStr() : null }));
  $('neuTitel').value = ''; $('neuFaellig').value = ''; delete $('neuWer').dataset.gewaehlt; neuHeute = false; await laden();
};
$('neuZu').onchange = render;
$('neuWer').onchange = () => { $('neuWer').dataset.gewaehlt = $('neuWer').value; };
$('neuHeute').onclick = () => { neuHeute = !neuHeute; render(); };
$('filter').onchange = e => { filter = e.target.value; render(); }; $('filterWer').onchange = e => { filterWer = e.target.value; render(); };

// ---------- Start: Anmeldung, Name, Ordner ----------
function zeigeName() {
  const box = $('nameListe'); box.replaceChildren();
  for (const n of data.nutzer || []) box.append(el('button', { className: 'ghost', textContent: n, onclick: () => setzeName(n) }));
  zeige('pName');
}
async function setzeName(n) {
  me = n.trim(); if (!me) return; ls.set('nutzer', me);
  await run(async () => { await Drive.registerUser(me); bereit = true; schliesse(); bekannt = null; await laden(); });
}
$('nameOk').onclick = () => setzeName($('nameNeu').value);

async function verbinden() {
  await run(async () => {
    try { await Drive.connect(CFG.ordner); }
    catch (e) { if (e.message === 'ORDNER') { zeige('pLogin'); $('loginErr').textContent = 'Ordner „' + CFG.ordner + '“ nicht gefunden. Ist er für dein Google-Konto freigegeben?'; return; } throw e; }
    const d = await Drive.load(); data = d;
    if (me) await setzeName(me); else zeigeName();
  });
}
async function anmelden() {
  $('loginErr').textContent = '';
  try { await Drive.signIn(); } catch { $('loginErr').textContent = 'Anmeldung nicht möglich oder abgebrochen.'; zeige('pLogin'); return; }
  await verbinden();
}
$('bLogin').onclick = anmelden;

(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!CFG.clientId || CFG.clientId.startsWith('DEINE-CLIENT-ID')) { $('loginText').textContent = 'Einrichtung fehlt: In config.js ist noch keine Google-Client-ID eingetragen (siehe PWA-EINRICHTUNG.md).'; $('bLogin').hidden = true; return; }
  Drive.init(CFG.clientId);
  if (Drive.eingeloggt()) await verbinden();          // Token aus der letzten Sitzung noch gültig
  setInterval(() => { if (!document.hidden) laden(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) laden(); });
})();
