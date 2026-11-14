/* Merilohitutka – service worker (v26, 14.11.2026)

   TEHTÄVÄ: sovellus käynnistyy merellä ilman verkkoa (aloitusnäytön kuvakkeesta tai selaimesta).

   TALLENNETAAN: sivu (index.html), sen skriptit sellaisina kuin sivu ne nimeää (?v=-numerot luetaan sivusta,
   joten listaa ei ylläpidetä käsin), manifest ja kuvakkeet.

   EI TALLENNETA TÄNNE:
   - data/ (meridata, syvyyskäyrät, väylät): sivu tallentaa ne itse välimuistiin mlt-meri-1 ja tietää niiden iän.
   - ulkoiset osoitteet (Ilmatieteen laitos, Digitraffic AIS): vanha sää tai vanhat alusten paikat olisivat
     harhaanjohtavia. Sivu muistaa viimeisimmän sään itse (mlt_data).

   SIVUN HAKU: verkosta ensin, mutta jos vastaus ei tule ODOTUS_MS:ssa, tallennettu sivu heti (heikko kenttä merellä).
   Verkkohaku jatkuu taustalla ja päivittää tallennetun seuraavaa käynnistystä varten.
   Uusi sivu tallennetaan vasta, kun kaikki sen skriptit ovat tallessa: tallennettu sivu ja skriptit ovat aina pari.

   SIIVOUS: vain omat merilohitutka-alkuiset välimuistit. lohirosvo.github.io:ssa on myös uistelututka, ja selaimen
   välimuisti (Cache Storage) on yhteinen koko osoitteelle: muiden poisto veisi uistelututkan tiedostot.

   VERSIO: kasvata, kun manifest tai kuvakkeet muuttuvat. Skriptien ?v=-muutokset tulevat ilman versionnostoa. */
const VERSIO = 'merilohitutka-v26';
const ETULIITE = 'merilohitutka-';
const ODOTUS_MS = 4000;
const JUURI = new URL('./', self.location).href;
const SIVU = JUURI + 'index.html';
const KIINTEAT = ['manifest.json', 'icon-192.png', 'icon-512.png', 'icon-192-maskable.png', 'icon-512-maskable.png',
  'apple-touch-icon.png', 'favicon-48.png'].map(n => JUURI + n);

function skriptit(html) {
  const out = [], re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) { const u = new URL(m[1], JUURI); if (u.href.startsWith(JUURI)) out.push(u.href); }
  return out;
}
const nimi = u => u.slice(JUURI.length);

/** Verkosta ohi selaimen oman välimuistin (GitHub Pages pyytää säilyttämään 10 min); 304-tarkistus on kevyt. */
async function hae(url) {
  const r = await fetch(new Request(url, { cache: 'no-cache', credentials: 'same-origin' }));
  if (!r.ok) throw new Error(nimi(url) + ': HTTP ' + r.status);
  return r;
}
/** Uudelleenohjattua vastausta ei saa antaa sivulle navigoinnin vastauksena: tehdään siitä tavallinen kopio. */
async function puhdas(r) {
  return r.redirected ? new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers }) : r;
}

/** Tallentaa sivun ja sen tiedostot välimuistiin c. Sivu kirjoitetaan vasta, kun sen skriptit ovat tallessa.
    Palauttaa { ok, puuttuu: [nimet], tiedostoja }. */
async function tallennaSivu(c, sivu) {
  const tarvitaan = skriptit(await sivu.clone().text());
  const puuttuu = [];
  for (const u of tarvitaan.concat(KIINTEAT)) {
    if (await c.match(u)) continue;
    try { await c.put(u, await hae(u)); } catch (e) { puuttuu.push(nimi(u)); }
  }
  if (tarvitaan.some(u => puuttuu.includes(nimi(u)))) return { ok: false, puuttuu, tiedostoja: tarvitaan.length + 1 };
  await c.put(SIVU, sivu);
  const pidetaan = new Set([SIVU].concat(tarvitaan, KIINTEAT));   // vanhat ?v=-versiot pois
  for (const k of await c.keys()) if (!pidetaan.has(k.url)) await c.delete(k);
  return { ok: !puuttuu.length, puuttuu, tiedostoja: pidetaan.size };
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSIO);
    const t = await tallennaSivu(c, await puhdas(await hae(SIVU)));
    // Ilman sivua ja kaikkia skriptejä asennus epäonnistuu: vanha versio jää käyttöön ja uutta yritetään myöhemmin.
    if (!(await c.match(SIVU))) throw new Error('sovellus ei tallentunut: ' + t.puuttuu.join(', '));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const a of await caches.keys()) if (a.startsWith(ETULIITE) && a !== VERSIO) await caches.delete(a);
    await self.clients.claim();
  })());
});

function sivuHaku(e) {
  const verkko = fetch(new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })).then(puhdas);
  // Kopio otetaan heti, ennen kuin selain alkaa lukea vastausta.
  e.waitUntil(verkko.then(r => {
    if (!r.ok) return;
    const kopio = r.clone();
    return caches.open(VERSIO).then(c => tallennaSivu(c, kopio));
  }).catch(() => {}));
  e.respondWith((async () => {
    const talletettu = await (await caches.open(VERSIO)).match(SIVU);
    if (!talletettu) return verkko;   // ensimmäinen kerta: odotetaan verkkoa
    const r = await Promise.race([verkko.catch(() => null), new Promise(res => setTimeout(res, ODOTUS_MS, null))]);
    return r && r.ok ? r : talletettu;
  })());
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(JUURI)) return;   // ulkoiset rajapinnat aina verkkoon
  const polku = nimi(req.url).split(/[?#]/)[0];
  if (polku === 'sw.js' || polku.startsWith('data/')) return;      // meridata: sivu hoitaa itse
  if (req.mode === 'navigate') { sivuHaku(e); return; }
  e.respondWith((async () => {
    const c = await caches.open(VERSIO);
    const v = await c.match(req);
    if (v) return v;
    const r = await fetch(req);
    if (r.ok && r.type === 'basic') e.waitUntil(c.put(req, r.clone()).catch(() => {}));
    return r;
  })());
});

/* Sivu kysyy latauksen jälkeen: onko kaikki tallessa? Samalla puuttuvat haetaan (esim. jos jokin toinen sovellus
   samassa osoitteessa on tyhjentänyt välimuistin) ja vastataan sivulle tilalla. */
self.addEventListener('message', e => {
  if (!e.data || e.data.tyyppi !== 'varmista') return;
  e.waitUntil((async () => {
    const c = await caches.open(VERSIO);
    let sivu = await c.match(SIVU);
    if (!sivu) sivu = await hae(SIVU).then(puhdas).catch(() => null);
    const t = sivu ? await tallennaSivu(c, sivu) : { ok: false, puuttuu: ['index.html'], tiedostoja: 0 };
    if (e.source) e.source.postMessage(Object.assign({ tyyppi: 'swTila', versio: VERSIO }, t));
  })());
});
