/* Merilohitutka – ikaluokat.js (v58, 17.11.2026)
 * Lohen saapuminen alueittain ja ikäluokittain (silakkatietopohja v009 kohta 7.7).
 * Hannu 17.11.: "aluekohtaisesti vastaavat kuvaajat oletetuilla päivillä joka päivittyy tilanteen mukaan. Nyt käytettäneen
 * toteutuneita arvoja ennen uutta kautta. Tilannekuvassa kokoluokka olettama … kyseisellä viikolla." → "tee mahdollisimman
 * osuva. Sellainen mikä kertoo ennen kuin asiat tapahtuu."
 *
 * MALLI
 *  1. Pohja = toteutunut ajoitus Tornionjoen Kattilakoskella (kaikuluotain ~100 km jokisuusta) [L61, kesä 2025]:
 *     monimerivuotisten päivähuippu 24.–26.6. (vpv 176), kossien 17.–20.7. (vpv 199,5).
 *     Monimerivuotiset = 2MV + 3MV seos; 2MV:n keskipäivä = seoksen huippu + MSW_SIIRTO [K], 3MV 14 vrk 2MV:tä aiemmin [L49].
 *  2. Vuosien ero: −4,6 vrk/°C huhtikuun pintalämmön erosta (Trelleborg–Sassnitz) pohjavuoteen 2025 [L49 kerroin].
 *     Ennen kauden omaa huhtikuuta käytetään viimeisintä (Hannu 17.11.).
 *  3. Alueelle: jokilaskurilta taaksepäin (matka alueen keskeltä Tornionjoen suulle linnuntietä + 100 km jokea) /
 *     20–50 km/vrk [L48] → haarukka; keskiarvio = viiveiden keskikohta [A]. Todellinen reitti on pidempi [A].
 *  4. Jakauma ikäluokan sisällä normaali, keskihajonta 15,5 vrk [K]: L49:n 16,0–18,2 vrk on jokikannan saalispäivien hajonta
 *     ilman kosseja, eli 2- ja 3-vuotiaat yhdessä (14 vrk ero, osuudet 60/40 → ikäluokan oma √(17² − 0,24·14²) ≈ 15,5).
 *     Tarkistus 2025 [K]: 2MV-keskipäivä 181 − 2 × 15,5 = 150 (nousu alkoi toukokuun lopussa [L61]); kossit 199,5 + 31 = 230
 *     (elokuun puolivälin jälkeen alle 100/vrk [L61]).
 *  5. Osuudet (kpl): kossit 32 % kaikuluotauksesta, monimerivuotiset 68 % jaettuna suomunäytteiden suhteessa 43:29 [L61, K].
 *  6. Painot: 2MV 4–8 kg [L Luke/Yle 2026]; lisämerivuosi +4–5 kg [L HY] → isot yli 8 kg, kossit alle 4 kg [K].
 *
 * v59 LOMAVIIKKO (Hannu 17.11.: "Kallan optimoi lohen vaelluksen voimakkuus ja 20 m vesillä / noin 5 km rannasta 6-8 C
 * vedenlämpötila ja tuulet alle 8 m/s paras viikko. Käytä toteutuneita tuulia ja veden pintalämpötiloja … 2028 veikkaus"):
 * jokaiselle toteutuneelle kesälle (data/lomadata.json) päivä kerrallaan
 *   kala  = mallin viikkotaso pisteessä sen vuoden huhtikuulla (0–1),
 *   lämpö = satelliitin pintalämpö 6–8 °C,
 *   tuuli = päiväsaikaan (6–20) vähintään 2/3 tunneista keskituuli < 8 m/s [A: "tuulet alle 8" päiväksi tulkittuna],
 *   arvo  = kala × (lämpö ja tuuli kunnossa).
 * Tavoitevuoden viikot (ma–su) saman kalenteripäivän mukaan; arvo × 7 = "hyviä kalapäiviä viikossa" keskimäärin.
 */
(function (root) {
  'use strict';
  const IKALUOKAT = [
    { tunnus: '3MV', nimi: 'isot (3+ merivuotta)', lyhyt: '3MV', paino: 'yli 8 kg', osuus: 0.274 },
    { tunnus: '2MV', nimi: '2 merivuotta', lyhyt: '2MV', paino: '4–8 kg', osuus: 0.406 },
    { tunnus: 'kossi', nimi: 'kossit (1 merivuosi)', lyhyt: 'kossit', paino: 'alle 4 kg', osuus: 0.32 },
  ];
  const HAJONTA = 15.5, KERROIN = 4.6, VALI_3MV = 14, KAUSI = ['05-01', '08-31'];
  const TOTEUMA = { vuosi: 2025, paikka: 'Kattilakoski', msw: 176, kossi: 199.5,
    teksti: 'Tornionjoki (Kattilakoski) 2025: monimerivuotisten huippu 24.–26.6., kossien 17.–20.7.' };
  const JOKI_KM = 100, NOPEUS = [20, 50], TORNIO = { lat: 65.78, lon: 24.17 };
  const OSUUDET = {   // [L61] näytetään tekstinä; IKALUOKAT.osuus johdettu näistä [K]
    lahde: 'Tornionjoki 2025 (Luke/SLU biologinen selvitys 2026)',
    kaiku: { kossi: 14585, msw: 30458, yht: 45043 }, suomu: { kossi: 0.28, '2MV': 0.43 },
  };

  /** Normaalijakauman kertymäfunktio (Abramowitz & Stegun 7.1.26, virhe < 1,5e-7). */
  function phi(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }
  /** Monimerivuotisten seoksen (2MV ja 14 vrk aiempi 3MV, painot osuuksista) huipun etäisyys 2MV:n keskipäivästä [K]. */
  const MSW_SIIRTO = (() => {
    const w2 = IKALUOKAT[1].osuus, w3 = IKALUOKAT[0].osuus, f = x => w2 * Math.exp(-x * x / (2 * HAJONTA * HAJONTA)) + w3 * Math.exp(-((x + VALI_3MV) ** 2) / (2 * HAJONTA * HAJONTA));
    let paras = 0;
    for (let x = -VALI_3MV; x <= 0; x += 0.01) if (f(x) > f(paras)) paras = x;
    return -paras;
  })();

  let muoto = null;
  /** Päivä Suomen ajassa (Europe/Helsinki): { vuosi, kk, pv, vpv }. */
  function paiva(t) {
    let v, kk, pv;
    try {
      muoto = muoto || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' });
      [v, kk, pv] = muoto.format(t).split('-').map(Number);
    } catch (e) { const d = new Date(t.getTime() + 3 * 3600000); v = d.getUTCFullYear(); kk = d.getUTCMonth() + 1; pv = d.getUTCDate(); }
    return { vuosi: v, kk, pv, vpv: Math.round((Date.UTC(v, kk - 1, pv) - Date.UTC(v, 0, 1)) / 86400000) + 1 };
  }
  function paivaksi(vuosi, vpv) { return new Date(Date.UTC(vuosi, 0, 1, 12) + (Math.round(vpv) - 1) * 86400000); }
  function pvT(vuosi, vpv) { const d = paivaksi(vuosi, vpv); return d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.'; }
  function vpvPaivasta(vuosi, kk, pv) { return Math.round((Date.UTC(vuosi, kk - 1, pv) - Date.UTC(vuosi, 0, 1)) / 86400000) + 1; }
  function kausiVuosi(t) { const p = paiva(t); return p.kk >= 9 ? p.vuosi + 1 : p.vuosi; }

  function matka(a, b) {
    const R = 6371, r = Math.PI / 180, dla = (b.lat - a.lat) * r, dlo = (b.lon - a.lon) * r;
    const h = Math.sin(dla / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function keskus(alue) {
    const r = alue && alue.rajat;
    return r ? { lat: (r.lat_min + r.lat_max) / 2, lon: (r.lon_min + r.lon_max) / 2 } : null;
  }
  /** Viive alueelta jokilaskurille (vrk): { km (merimatka), min, max, keski } tai null. */
  function viive(alue) {
    const k = keskus(alue); if (!k) return null;
    const km = matka(k, TORNIO), yht = km + JOKI_KM, min = yht / NOPEUS[1], max = yht / NOPEUS[0];
    return { km, min, max, keski: (min + max) / 2 };
  }

  /** Huhtikuun lämpöero pohjavuoteen: { vrk, T, vuosi, ref, refVuosi, syy }. huhtikuu = { "2025": 4.1 tai { T } }. */
  function siirto(huhtikuu, vuosi) {
    const arvo = v => { const x = (huhtikuu || {})[v]; const T = x && typeof x === 'object' ? x.T : x; return typeof T === 'number' && isFinite(T) ? T : null; };
    const vuodet = Object.keys(huhtikuu || {}).map(Number).filter(v => arvo(v) !== null && v <= vuosi).sort((a, b) => a - b);
    const kaytto = vuodet.length ? vuodet[vuodet.length - 1] : null, ref = arvo(TOTEUMA.vuosi);
    const pohja = { vrk: 0, T: kaytto !== null ? arvo(kaytto) : NaN, vuosi: kaytto, ref: ref === null ? NaN : ref, refVuosi: TOTEUMA.vuosi };
    if (ref === null) return Object.assign(pohja, { syy: kaytto === null ? 'ei-dataa' : 'ei-pohjavuotta' });
    if (kaytto === null || kaytto <= TOTEUMA.vuosi) return Object.assign(pohja, { syy: 'pohjavuosi' });
    return Object.assign(pohja, { vrk: -KERROIN * (arvo(kaytto) - ref) });
  }

  /** Keskipäivät (vpv) alueella vuodelle kv: [{ keski, aik, myoh }] ikäluokittain (3MV, 2MV, kossit). */
  function keskipaivat(kv, huhti, alue) {
    const s = siirto(huhti, kv), v = viive(alue);
    if (!v) return null;
    const m2 = TOTEUMA.msw + MSW_SIIRTO, joki = [m2 - VALI_3MV, m2, TOTEUMA.kossi];
    return { s, v, mu: joki.map(j => ({ keski: j + s.vrk - v.keski, aik: j + s.vrk - v.max, myoh: j + s.vrk - v.min })) };
  }
  const F = (mu, d) => phi((d - mu) / HAJONTA);
  /** Ikkunassa [d1, d2] saapuvat (osuus kaikista kaloista) ikäluokittain. */
  function saapuvat(mus, d1, d2) { return mus.map((mu, i) => IKALUOKAT[i].osuus * (F(mu, d2 + 0.5) - F(mu, d1 - 0.5))); }
  /** Viikkotiheys (7 vrk ikkuna keskellä d) suhteessa kauden suurimpaan: 0–1. */
  function viikkoTaso(mus, d) {
    const y = s => s.reduce((a, b) => a + b, 0), x = y(saapuvat(mus, d - 3, d + 3));
    let mx = 0; for (let k = 100; k <= 270; k++) mx = Math.max(mx, y(saapuvat(mus, k - 3, k + 3)));
    return mx ? x / mx : 0;
  }
  /** Pääjoukko (viikkotiheys ≥ 50 % huipusta): { alku, huippu, loppu } (vpv). */
  function paajoukko(mus) {
    const y = s => s.reduce((a, b) => a + b, 0), arvot = [];
    for (let k = 100; k <= 270; k++) arvot.push([k, y(saapuvat(mus, k - 3, k + 3))]);
    const mx = Math.max(...arvot.map(a => a[1])), yli = arvot.filter(a => a[1] >= mx / 2);
    return { alku: yli[0][0], loppu: yli[yli.length - 1][0], huippu: arvot.find(a => a[1] === mx)[0] };
  }
  function koostumus(mus, d) {
    const s = saapuvat(mus, d - 3, d + 3), y = s.reduce((a, b) => a + b, 0);
    return y > 0 ? s.map(x => x / y) : s.map(() => 0);
  }
  function tasoSana(taso, ennenHuippua) {
    if (taso < 0.15) return 'vähän';
    if (taso < 0.5) return ennenHuippua ? 'kasvaa' : 'hiipuu';
    return taso >= 0.9 ? 'huipussa' : 'runsaasti';
  }

  /** Kaikki alueen arvio päivälle t. */
  function alueArvio(t, huhti, alue) {
    const kv = kausiVuosi(t), p = paiva(t), k = keskipaivat(kv, huhti, alue);
    if (!k) return null;
    const x = String(p.kk).padStart(2, '0') + '-' + String(p.pv).padStart(2, '0');
    const kaudella = p.vuosi === kv && x >= KAUSI[0] && x <= KAUSI[1];
    const vpv = p.vuosi === kv ? p.vpv : 0;
    const muK = k.mu.map(m => m.keski), muA = k.mu.map(m => m.aik), muM = k.mu.map(m => m.myoh);
    const pj = { keski: paajoukko(muK), aik: paajoukko(muA), myoh: paajoukko(muM) };
    const luokat = IKALUOKAT.map((L, i) => Object.assign({}, L, {
      mu: muK[i], muAik: muA[i], muMyoh: muM[i],
      osuusNyt: vpv ? F(muK[i], vpv) : 0, osuusVali: vpv ? [F(muM[i], vpv), F(muA[i], vpv)] : [0, 0],
    }));
    const kokoNyt = vpv ? koostumus(muK, vpv) : null, tasoNyt = vpv ? viikkoTaso(muK, vpv) : 0;
    return { kausiVuosi: kv, kaudella, vpv, siirto: k.s, viive: k.v, luokat, paajoukko: pj, kokoNyt, tasoNyt,
      tasoSana: vpv ? tasoSana(tasoNyt, vpv < pj.keski.huippu) : null, mus: { keski: muK, aik: muA, myoh: muM } };
  }
  /** Viikon arvio päivän t ympärillä (kartta): { kokoonpano 0–1 ×3, hallitseva, taso, sana, kaudella } . */
  function viikkoArvio(t, huhti, alue) {
    const a = alueArvio(t, huhti, alue);
    if (!a) return null;
    if (!a.vpv) return Object.assign(a, { hallitseva: null });
    const i = a.kokoNyt.indexOf(Math.max(...a.kokoNyt));
    return Object.assign(a, { hallitseva: a.tasoNyt >= 0.05 ? i : null });
  }
  /** Seuraava hallitsevan kokoluokan vaihtuminen (≤ 30 vrk): { vpv, i } tai null. */
  function seuraavaVaihto(a) {
    if (!a.vpv) return null;
    const mus = a.mus.keski, h = d => { const c = koostumus(mus, d); return c.indexOf(Math.max(...c)); }, nyt = h(a.vpv);
    for (let d = a.vpv + 1; d <= a.vpv + 30; d++) { const x = h(d); if (x !== nyt && viikkoTaso(mus, d) >= 0.05) return { vpv: d, i: x }; }
    return null;
  }
  const pyor = x => Math.round(x);
  /** Haarukan puolikas (vrk) viiveestä: (max − min) / 2, sama kaikille päivämäärille. */
  function haarukka(a) { return pyor((a.viive.max - a.viive.min) / 2); }
  /** Ennakkoteksti (Vesillä-rivi): ennen pääjoukkoa alkamispäivä ja haarukka, sen aikana koko ja seuraava vaihto. */
  function ennakkoTeksti(a) {
    if (!a) return '';
    const kv = a.kausiVuosi, pj = a.paajoukko, L = a.luokat, pv = d => pvT(kv, d);
    const alkuR = haarukka(a);
    const koko = i => `${L[i].lyhyt} ${L[i].paino}`;
    if (!a.vpv || a.vpv < pj.aik.alku - 30) {   // syys–huhtikuu: kauden yhteenveto
      return `Lohet ${kv} (arvio): pääjoukko ${pv(pj.keski.alku)}–${pv(pj.keski.loppu)} (alku ±${alkuR} vrk), huippu ~${pv(pj.keski.huippu)} · isot ensin, kossit ~${pv(L[2].mu)}`;
    }
    const d = a.vpv, vaihto = seuraavaVaihto(a), hall = a.kokoNyt.indexOf(Math.max(...a.kokoNyt));
    const vt = vaihto ? ` · ${L[vaihto.i].lyhyt} enemmistönä ~${pv(vaihto.vpv)}` : '';
    if (d < pj.keski.alku) {
      const pv0 = pj.keski.alku - d;
      return `Pääjoukko alkaa ~${pv(pj.keski.alku)} (${pv(pj.aik.alku)}–${pv(pj.myoh.alku)}), ${pv0} vrk päästä · nyt ${a.tasoSana}` + (a.tasoNyt >= 0.05 ? `, pääosin ${koko(hall)}` : '');
    }
    if (d <= pj.keski.loppu) return `Nyt ${a.tasoSana}: pääosin ${koko(hall)}` + (d < pj.keski.huippu ? ` · huippu ~${pv(pj.keski.huippu)}` : '') + vt;
    return `Hiipuu: pääosin ${koko(hall)} · pääjoukko oli ${pv(pj.keski.alku)}–${pv(pj.keski.loppu)}`;
  }
  /** Kartan viikkorivi päivälle t. */
  function viikkoTeksti(a) {
    if (!a) return '';
    if (!a.vpv || a.tasoNyt < 0.05) {
      const pj = a.paajoukko, kv = a.kausiVuosi;
      return `ei nousulohia · ${kv} pääjoukko ~${pvT(kv, pj.keski.alku)}–${pvT(kv, pj.keski.loppu)}`;
    }
    const L = a.luokat, c = a.kokoNyt, jarj = [0, 1, 2].sort((x, y) => c[y] - c[x]);
    return `${a.tasoSana}: ` + jarj.filter(i => c[i] >= 0.05).map(i => `${L[i].lyhyt} ${L[i].paino} ${Math.round(c[i] * 100)} %`).join(', ');
  }
  /** Käyrät piirtoa varten: [{ vpv, kertyma: { keski, aik, myoh }[3], paiva: [3] (saapuvat/vrk) }]. */
  function kayrat(a, alku, loppu) {
    const out = [];
    for (let d = alku; d <= loppu; d++) out.push({ vpv: d,
      keski: a.mus.keski.map(mu => F(mu, d)), aik: a.mus.aik.map(mu => F(mu, d)), myoh: a.mus.myoh.map(mu => F(mu, d)),
      paiva: saapuvat(a.mus.keski, d, d) });
    return out;
  }

  // ---------------------------------------------------------------- v59 lomaviikko
  const LOMA = { lampo: [6, 8], tuuliOsuus: 2 / 3, tuuliMinTunnit: 10 };
  function isoViikko(d) {   // d: Date (UTC-päivä)
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), pv = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - pv + 3);
    const eka = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t - eka) / 86400000 - 3 + ((eka.getUTCDay() + 6) % 7)) / 7);
  }
  /** Viikkotasot päiville d1..d2 (yksi huipun laskenta). */
  function tasoSarja(mus, d1, d2) {
    const y = s => s.reduce((a, b) => a + b, 0);
    let mx = 0; for (let k = 100; k <= 270; k++) mx = Math.max(mx, y(saapuvat(mus, k - 3, k + 3)));
    const out = []; for (let d = d1; d <= d2; d++) out.push(mx ? y(saapuvat(mus, d - 3, d + 3)) / mx : 0);
    return out;
  }
  /** Päiväkohtaiset arvot yhdelle toteutuneelle kesälle: [{ kala, lampo (bool|null), tuuli (bool|null), T }]. */
  function lomaVuosi(vuosi, rivi, huhti, piste) {
    const alue = { rajat: { lat_min: piste.lat, lat_max: piste.lat, lon_min: piste.lon, lon_max: piste.lon } };
    const k = keskipaivat(vuosi, huhti, alue), v0 = vpvPaivasta(vuosi, 5, 1), n = (rivi.sst || []).length;
    const kala = tasoSarja(k.mu.map(m => m.keski), v0, v0 + n - 1);
    return (rivi.sst || []).map((s, j) => {
      const T = typeof s === 'number' ? s / 10 : null, w = (rivi.tuuli || [])[j];
      return { kala: kala[j], T, lampo: T === null ? null : T >= LOMA.lampo[0] && T <= LOMA.lampo[1],
        tuuli: !w || w[1] < LOMA.tuuliMinTunnit ? null : w[0] / w[1] >= LOMA.tuuliOsuus };
    });
  }
  /** Tavoitevuoden viikot (ma–su, 1.5.–31.7.) toteutuneiden kesien keskiarvona. */
  function lomaviikot(lomadata, huhti, tavoite) {
    const vuodet = Object.keys((lomadata && lomadata.vuodet) || {}).sort();
    if (!vuodet.length || !lomadata.piste) return null;
    const paivat = {}; vuodet.forEach(y => { paivat[y] = lomaVuosi(+y, lomadata.vuodet[y], huhti, lomadata.piste); });
    const a0 = Date.UTC(tavoite, 4, 1), n = 92, viikot = [];
    let ma = a0 - (((new Date(a0).getUTCDay() + 6) % 7) * 86400000);
    for (; ma < a0 + n * 86400000; ma += 7 * 86400000) {
      const jj = []; for (let i = 0; i < 7; i++) { const j = Math.round((ma + i * 86400000 - a0) / 86400000); if (j >= 0 && j < n) jj.push(j); }
      if (jj.length < 4) continue;   // vajaat reunaviikot pois
      const kaikki = [], vuosittain = {};
      vuodet.forEach(y => { const pv = paivat[y]; vuosittain[y] = 0;
        jj.forEach(j => { const p = pv[j]; if (!p) return; kaikki.push(p); if (p.lampo && p.tuuli) vuosittain[y] += p.kala; }); });
      const ka = (f, s) => { const x = s.filter(p => f(p) !== null); return x.length ? x.reduce((a, p) => a + f(p), 0) / x.length : NaN; };
      const mo = kaikki.filter(p => p.lampo !== null && p.tuuli !== null);
      viikot.push({ vk: isoViikko(new Date(ma)), alku: new Date(ma), loppu: new Date(ma + 6 * 86400000), paivia: jj.length,
        kala: ka(p => p.kala, kaikki), lampo: ka(p => p.lampo === null ? null : +p.lampo, kaikki), tuuli: ka(p => p.tuuli === null ? null : +p.tuuli, kaikki),
        molemmat: ka(p => +(p.lampo && p.tuuli), mo), arvo: 7 * ka(p => p.kala * (p.lampo && p.tuuli ? 1 : 0), mo), vuosittain });
    }
    const jarj = viikot.map((w, i) => i).filter(i => isFinite(viikot[i].arvo)).sort((x, y) => viikot[y].arvo - viikot[x].arvo);
    const parhaat = {}; vuodet.forEach(y => { let b = null; viikot.forEach(w => { if (!b || w.vuosittain[y] > b.vuosittain[y]) b = w; }); parhaat[y] = b && b.vuosittain[y] > 0 ? b.vk : null; });
    return { tavoite, vuodet, viikot, jarjestys: jarj, parhaatVuosittain: parhaat };
  }

  const Ikaluokat = { IKALUOKAT, HAJONTA, KERROIN, VALI_3MV, KAUSI, TOTEUMA, JOKI_KM, NOPEUS, TORNIO, OSUUDET, MSW_SIIRTO,
    phi, paiva, paivaksi, pvT, vpvPaivasta, kausiVuosi, matka, keskus, viive, siirto, keskipaivat, saapuvat, viikkoTaso,
    LOMA, isoViikko, tasoSarja, lomaVuosi, lomaviikot,
    paajoukko, koostumus, haarukka, alueArvio, viikkoArvio, seuraavaVaihto, ennakkoTeksti, viikkoTeksti, kayrat };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ikaluokat; else root.Ikaluokat = Ikaluokat;
})(typeof window !== 'undefined' ? window : this);
