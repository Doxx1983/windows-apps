'use strict';
// UI-Test: Renderer in Chromium, window.api mit echtem Store verbunden (ohne Electron).
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
const { Store } = require('../src/store');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todoui-'));
  const store = new Store(dir, 'Anna');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 580 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const store_remove_impl = (i, n) => store.removeFile(i, n);
  await page.exposeFunction('store_remove', store_remove_impl);
  const m = { laden: () => store.load(), neu: d => store.create(d), aendern: (i, p) => store.update(i, p), loeschen: i => store.remove(i),
    projektNeu: d => store.addProject(d), projektAendern: (i, p) => store.updateProject(i, p), projektLoeschen: i => store.removeProject(i), dateiHinzu: (i, p) => store.addFiles(i, p), eingangZuordnen: (n, i) => store.inboxAssign(n, i), eingangNeu: (n, e) => store.inboxNewTask(n, e) };
  for (const k of Object.keys(m)) await page.exposeFunction('__' + k, m[k]);
  await page.addInitScript(() => {
    let cb = () => {};
    window.api = { config: async () => ({ nutzer: 'Anna', ordner: 'x', bereit: true }), configSetzen: async c => ({ ...c, bereit: true }),
      ordnerWaehlen: async () => 'x', verstecken() {}, modus: new URLSearchParams(location.search).get('gross') ? 'gross' : 'popup',
      grossOeffnen: () => { window.__gross = (window.__gross || 0) + 1; }, popupOeffnen: () => { window.__popup = (window.__popup || 0) + 1; }, vollbild: () => { window.__voll = (window.__voll || 0) + 1; }, beiGrossStatus: f => { window.__grossStatus = f; }, beiAenderung: f => { cb = f; }, __cb: () => cb(),
      laden: () => window.__laden(), neu: d => window.__neu(d), aendern: (i, p) => window.__aendern(i, p), loeschen: i => window.__loeschen(i),
      projektNeu: d => window.__projektNeu(d), projektAendern: (i, p) => window.__projektAendern(i, p), projektLoeschen: i => window.__projektLoeschen(i),
      breite: w => { window.__breite = w; }, dateiHinzu: (i, p) => window.__dateiHinzu(i, p), dateiOeffnen() {}, eingangZuordnen: (n, i) => window.__eingangZuordnen(n, i), eingangNeu: (n, e) => window.__eingangNeu(n, e), eingangOeffnen() {}, eingangLoeschen() {}, dateiZeigen() {}, dateiLoeschen: async (i, n) => store_remove(i, n) };
  });
  await page.goto('file://' + path.resolve(__dirname, '../src/index.html'));

  await page.click('#bProj'); await page.fill('#pName', 'Häkelapp'); await page.click('#pAdd');
  await page.fill('#pName', 'Chat Planung'); await page.selectOption('#pTyp', 'chat'); await page.click('#pAdd'); await page.click('#pOk');
  assert.strictEqual(store.load().projekte.length, 2);

  await page.fill('#neuTitel', 'Garn bestellen'); await page.click('#neuHeute');
  await page.selectOption('#neuZu', { label: '📁 Häkelapp' }); await page.press('#neuTitel', 'Enter');
  await page.fill('#neuTitel', 'Rechnung'); await page.press('#neuTitel', 'Enter'); // in Ansicht "Heute" => automatisch heute
  assert.strictEqual(store.load().aufgaben.length, 2);
  assert.strictEqual(await page.locator('.task').count(), 2);

  await page.click('nav button:has-text("Offen")'); assert.strictEqual(await page.locator('.task').count(), 2);
  await page.locator('.task .box').first().click();                   // abhaken
  assert.strictEqual(store.load().aufgaben.filter(t => t.erledigt).length, 1);
  await page.click('nav button:has-text("Erledigt")'); assert.strictEqual(await page.locator('.task.done').count(), 1);
  await page.click('.task .act button[title=Archivieren]');
  await page.click('nav button:has-text("Archiv")'); assert.strictEqual(await page.locator('.task').count(), 1);
  await page.click('.task .act button[title="Zurückholen"]');
  await page.click('nav button:has-text("Offen")'); await page.selectOption('#filter', { label: '📁 Häkelapp' });
  assert.strictEqual(await page.locator('.task').count(), 1);
  // Änderung durch zweiten Nutzer
  new Store(dir, 'Ben').create({ titel: 'Von Ben' }); await page.selectOption('#filter', ''); await page.evaluate(() => window.api.__cb());
  await page.waitForTimeout(200);
  assert.ok((await page.locator('.task').allTextContents()).some(t => t.includes('Von Ben')));
  // Detail = Entwurf: Änderungen gelten erst mit "Speichern", "Zurück" verwirft sie
  const gbRow = () => page.locator('.task .t', { hasText: 'Garn bestellen' });
  await page.click('nav button:has-text("Offen")');
  await gbRow().click(); await page.click('#dZurueck'); assert.ok(await page.locator('#pTask').isHidden());       // nichts geändert: ohne Rückfrage zurück
  await gbRow().click();
  await page.locator('#dWer .chip', { hasText: 'Ben' }).click(); await page.fill('#dFaellig', '2020-01-01'); await page.dispatchEvent('#dFaellig', 'change');
  await page.selectOption('#dStatus', 'doing'); await page.check('#dAblegen');
  let gb = store.load().aufgaben.find(t => t.titel === 'Garn bestellen');
  assert.deepStrictEqual(gb.zugewiesenAn, ['Anna']); assert.notStrictEqual(gb.status, 'doing'); assert.strictEqual(gb.ablegen, false);   // noch nichts gespeichert
  assert.ok(await page.locator('#dDirty').isVisible());
  const shot = async (n, y) => { await page.evaluate(v => document.getElementById('pTask').scrollTo(0, v), y); await page.screenshot({ path: path.join(process.argv[2] || require('os').tmpdir(), n) }); };
  await shot('ui-detail-top.png', 0); await shot('ui-detail-bottom.png', 99999);
  page.once('dialog', d => d.dismiss()); await page.click('#dZurueck');                                           // Rückfrage abgelehnt: bleibt offen, Entwurf bleibt
  assert.ok(await page.locator('#pTask').isVisible()); assert.strictEqual(await page.locator('#dStatus').inputValue(), 'doing');
  page.once('dialog', d => d.accept()); await page.click('#dZurueck');                                            // Rückfrage bestätigt: verworfen
  assert.ok(await page.locator('#pTask').isHidden());
  gb = store.load().aufgaben.find(t => t.titel === 'Garn bestellen'); assert.deepStrictEqual(gb.zugewiesenAn, ['Anna']); assert.notStrictEqual(gb.status, 'doing');
  await gbRow().click(); assert.strictEqual(await page.locator('#dStatus').inputValue(), 'todo');                   // Entwurf ist weg
  await page.locator('#dWer .chip', { hasText: 'Ben' }).click(); await page.fill('#dFaellig', '2020-01-01'); await page.dispatchEvent('#dFaellig', 'change');
  await page.selectOption('#dStatus', 'doing'); await page.check('#dAblegen');
  const f = path.join(dir, 'angebot.pdf'); fs.writeFileSync(f, 'x');                                              // Dateien wirken sofort (auch ohne Speichern)
  await page.evaluate(([id, p]) => window.api.dateiHinzu(id, [p]), [gb.id, f]); await page.evaluate(() => window.api.__cb()); await page.waitForTimeout(250);
  assert.ok((await page.locator('#dDateien').textContent()).includes('angebot.pdf'));
  assert.strictEqual(await page.locator('#dStatus').inputValue(), 'doing');                                       // Entwurf überlebt das Neuladen
  await page.click('#dOk'); await page.waitForTimeout(250);
  gb = store.load().aufgaben.find(t => t.titel === 'Garn bestellen');
  assert.deepStrictEqual(gb.zugewiesenAn, ['Anna', 'Ben']); assert.strictEqual(gb.faellig, '2020-01-01'); assert.strictEqual(gb.status, 'doing'); assert.strictEqual(gb.ablegen, true);
  assert.ok((await page.locator('.tag.late').count()) >= 1);                  // überfällig markiert
  // Abhängigkeit: B wartet auf A -> kann nicht abgehakt werden, bis A erledigt ist; Teilschritte
  const sa = store.create({ titel: 'Erst A' }), sbb = store.create({ titel: 'Dann B' }); store.update(sbb.id, { abhaengigVon: [sa.id] });
  await page.click('nav button:has-text("Offen")'); await page.evaluate(() => window.api.__cb()); await page.waitForTimeout(250);
  const brow = page.locator('.task', { hasText: 'Dann B' });
  assert.ok((await brow.locator('.tag.blk').textContent()).includes('wartet auf Erst A'));
  await brow.locator('.box').click();
  assert.ok((await page.locator('#toast').textContent()).includes('Wartet noch auf: Erst A')); assert.strictEqual(store.load().aufgaben.find(t => t.id === sbb.id).status, 'todo');
  await brow.locator('.t').click();
  assert.ok((await page.locator('#dBlock').textContent()).includes('Erst A')); assert.ok(await page.evaluate(() => document.querySelector('#dStatus option[value=done]').disabled));
  await page.fill('#dSchrittNeu', 'Kartons'); await page.press('#dSchrittNeu', 'Enter'); await page.waitForTimeout(150);
  await page.fill('#dSchrittNeu', 'Transporter'); await page.press('#dSchrittNeu', 'Enter'); await page.waitForTimeout(150);
  await page.locator('#dSchritte .step').first().locator('input').check(); await page.waitForTimeout(150);
  assert.strictEqual(store.load().aufgaben.find(t => t.id === sbb.id).schritte.length, 0);                  // noch Entwurf
  assert.strictEqual(await page.locator('#dFort').textContent(), ' (1/2)');
  await page.selectOption('#dDepAdd', { label: 'Garn bestellen' }); await page.waitForTimeout(150);        // zweite Voraussetzung
  assert.strictEqual(await page.locator('#dDep .chip').count(), 2);
  assert.ok(!(await page.locator('#dDepAdd option').allTextContents()).includes('Dann B'));                // nicht von sich selbst
  await page.screenshot({ path: path.join(process.argv[2] || require('os').tmpdir(), 'ui-detail.png') });
  await page.locator('#dDep .chip', { hasText: 'Garn bestellen' }).click(); await page.waitForTimeout(150);   // wieder entfernen
  assert.strictEqual(await page.locator('#dDep .chip').count(), 1);
  await page.click('#dOk'); await page.waitForTimeout(250);
  const gespeichert = store.load().aufgaben.find(t => t.id === sbb.id);
  assert.deepStrictEqual(gespeichert.schritte.map(x => [x.titel, x.erledigt]), [['Kartons', true], ['Transporter', false]]); assert.strictEqual(gespeichert.abhaengigVon.length, 1);
  await page.locator('.task', { has: page.locator('.t', { hasText: /^Erst A$/ }) }).locator('.box').click(); await page.waitForTimeout(250);   // A erledigt -> B frei
  assert.strictEqual(await page.locator('.task', { hasText: 'Dann B' }).locator('.tag.blk').count(), 0);
  await page.locator('.task', { hasText: 'Dann B' }).locator('.box').click(); await page.waitForTimeout(250);
  assert.strictEqual(store.load().aufgaben.find(t => t.id === sbb.id).status, 'done');
  // Speichern übernimmt ungespeicherten Text; "Aufgabe abschließen" setzt auf erledigt, bei Abhängigkeit gesperrt
  const sz = store.create({ titel: 'Zum Abschließen' }), sd = store.create({ titel: 'Noch offen' }), se = store.create({ titel: 'Hängt an offen' });
  store.update(se.id, { abhaengigVon: [sd.id] });
  await page.evaluate(() => window.api.__cb()); await page.waitForTimeout(250);
  await page.locator('.task .t', { hasText: 'Zum Abschließen' }).click();
  assert.strictEqual(await page.locator('#dOk').textContent(), 'Speichern');
  await page.fill('#dTitel', 'Verworfen'); page.once('dialog', d => d.accept()); await page.keyboard.press('Escape');     // Esc = Zurück
  assert.ok(await page.locator('#pTask').isHidden()); assert.strictEqual(store.load().aufgaben.find(t => t.id === sz.id).titel, 'Zum Abschließen');
  await page.locator('.task .t', { hasText: 'Zum Abschließen' }).click();
  await page.fill('#dTitel', 'Neuer Titel'); await page.fill('#dNotiz', 'Notiz dazu');   // ohne das Feld zu verlassen
  await page.click('#dOk'); await page.waitForTimeout(250);
  assert.ok(await page.locator('#pTask').isHidden());
  assert.deepStrictEqual([store.load().aufgaben.find(t => t.id === sz.id).titel, store.load().aufgaben.find(t => t.id === sz.id).notiz], ['Neuer Titel', 'Notiz dazu']);
  await page.locator('.task .t', { hasText: 'Neuer Titel' }).click();
  assert.strictEqual(await page.locator('#dAbschluss').textContent(), 'Aufgabe abschließen');
  await page.click('#dAbschluss'); await page.waitForTimeout(250);
  assert.ok(await page.locator('#pTask').isHidden()); assert.strictEqual(store.load().aufgaben.find(t => t.id === sz.id).status, 'done');
  await page.click('nav button:has-text("Erledigt")'); await page.locator('.task .t', { hasText: 'Neuer Titel' }).click();
  assert.strictEqual(await page.locator('#dAbschluss').textContent(), 'Wieder öffnen'); await page.click('#dAbschluss'); await page.waitForTimeout(250);
  assert.strictEqual(store.load().aufgaben.find(t => t.id === sz.id).status, 'todo');
  await page.click('nav button:has-text("Offen")'); await page.locator('.task .t', { hasText: 'Hängt an offen' }).click();
  assert.ok(await page.locator('#dAbschluss').isDisabled()); await page.click('#dOk');
  // Freigabe: Projekt von Ben nur für Ben -> Anna sieht weder Projekt noch Aufgabe; Mitglieder per Häkchen ändern
  const bs = new Store(dir, 'Ben'); const gp = bs.addProject({ name: 'Geheim', mitglieder: ['Ben'] }); bs.create({ titel: 'Überraschung', zuordnung: gp.id });
  await page.evaluate(() => window.api.__cb()); await page.waitForTimeout(250);
  assert.ok(!(await page.locator('#filter option').allTextContents()).some(t => t.includes('Geheim')));
  assert.ok(!(await page.locator('main').textContent()).includes('Überraschung'));
  await page.click('#bProj');
  await page.locator('#projListe .pl', { hasText: 'Häkelapp' }).locator('button[title^="Wer darf"]').click();
  await page.locator('#projListe .pl', { hasText: 'Häkelapp' }).locator('input[data-n=Ben]').uncheck(); await page.waitForTimeout(250);
  assert.deepStrictEqual(store.load().projekte.find(x => x.name === 'Häkelapp').mitglieder, ['Anna']);
  assert.ok(await page.locator('#projListe .pl', { hasText: 'Geheim' }).count() === 0);
  await page.click('#pOk');
  await page.selectOption('#neuZu', { label: '📁 Häkelapp' });
  assert.deepStrictEqual(await page.locator('#neuWer option').allTextContents(), ['Niemand', 'Anna (ich)']);   // nur Mitglieder wählbar
  // Eingang (Handy-Fotos)
  fs.writeFileSync(path.join(dir, 'eingang', 'foto1.jpg'), 'x'); fs.writeFileSync(path.join(dir, 'eingang', 'foto2.jpg'), 'x');
  await page.evaluate(() => window.api.__cb()); await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('#inN').textContent(), '2');
  await page.click('#bIn'); await page.locator('#inListe .pl').first().locator('select').selectOption({ label: 'Garn bestellen' });
  await page.locator('#inListe .pl').first().locator('button:has-text("Zuordnen")').click(); await page.waitForTimeout(200);
  assert.ok(store.load().aufgaben.find(t => t.id === gb.id).dateien.includes('foto1.jpg'));
  await page.locator('#inListe .pl').first().locator('button:has-text("Neue Aufgabe")').click(); await page.waitForTimeout(200);
  assert.ok(store.load().aufgaben.some(t => t.titel === 'foto2')); assert.deepStrictEqual(store.load().eingang, []);
  await page.click('#inOk');
  // Kanban
  await page.click('nav button:has-text("Board")'); await page.setViewportSize({ width: 900, height: 580 });   // wie das auf 900 px verbreiterte Fenster
  assert.strictEqual(await page.evaluate(() => window.__breite), 900);
  assert.strictEqual(await page.locator('.col[data-status=doing] .card').count(), 1);
  await page.locator('.col[data-status=doing] .card').dragTo(page.locator('.col[data-status=done]'));
  assert.strictEqual(store.load().aufgaben.find(t => t.id === gb.id).status, 'done');
  await page.locator('.col[data-status=done] .card button[title="Eine Spalte zurück"]').first().click();
  assert.strictEqual(store.load().aufgaben.find(t => t.id === gb.id).status, 'doing');
  await page.setViewportSize({ width: 900, height: 580 });
  await page.screenshot({ path: path.join(process.argv[2] || require('os').tmpdir(), 'board.png') });
  // Design: Auto -> Hell -> Dunkel
  const th = () => page.evaluate(() => document.documentElement.dataset.theme || 'auto');
  assert.strictEqual(await th(), 'auto'); await page.click('#bTheme'); assert.strictEqual(await th(), 'light'); await page.click('#bTheme'); assert.strictEqual(await th(), 'dark');
  const bg = c => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.strictEqual(await bg(), 'rgb(15, 17, 21)'); await page.screenshot({ path: path.join(process.argv[2] || require('os').tmpdir(), 'ui-dark.png') });
  await page.click('#bTheme'); await page.click('#bTheme'); await page.click('#bTheme');   // zurück auf Hell (light)
  await page.click('nav button:has-text("Offen")'); await page.click('#bTheme'); await page.click('#bTheme'); assert.strictEqual(await th(), 'light');
  assert.strictEqual(await bg(), 'rgb(246, 247, 249)');
  await page.screenshot({ path: path.join(process.argv[2] || require('os').tmpdir(), 'ui.png') });
  // Popup: Knopf öffnet das große Fenster, kein Vollbild-Knopf
  assert.ok(await page.locator('#bVoll').isHidden()); await page.click('#bGross'); assert.strictEqual(await page.evaluate(() => window.__gross), 1);
  // Großes Fenster (?gross=1): Vollbild-Knopf, kein Schließen-Kreuz, Knopf führt zurück zum Popup, Board nutzt die Breite
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('file://' + path.resolve(__dirname, '../src/index.html') + '?gross=1'); await page.waitForSelector('nav button');
  assert.ok(await page.evaluate(() => document.body.classList.contains('gross')));
  assert.ok(await page.locator('#bVoll').isVisible()); assert.ok(await page.locator('#bClose').isHidden());
  await page.click('#bVoll'); assert.strictEqual(await page.evaluate(() => window.__voll), 1);
  await page.click('#bGross'); assert.strictEqual(await page.evaluate(() => window.__popup), 1);
  await page.click('nav button:has-text("Board")'); await page.waitForTimeout(150);
  const bw = await page.locator('#board').evaluate(e => e.getBoundingClientRect().width), nw = await page.locator('#nav').evaluate(e => e.getBoundingClientRect().width);
  assert.ok(bw > 1150 && nw <= 1041, 'Board voll breit, Rest begrenzt: ' + bw + ' / ' + nw);
  await page.screenshot({ path: path.join(process.argv[2] || require('os').tmpdir(), 'ui-gross.png') });
  assert.deepStrictEqual(errs, []);
  await browser.close(); console.log('UI-Tests OK');
})().catch(e => { console.error(e); process.exit(1); });
