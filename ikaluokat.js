/* Merilohitutka – ikaluokat.js (v57, 17.11.2026)
 * Lohen saapuminen ikäluokittain (silakkatietopohja v007 kohta 7.7, Hannun idea 16.11.2026; Hannu 17.11. "Kyllä").
 *
 * MALLI: kertymä 0–100 % = normaalijakauman kertymäfunktio saalispäivästä.
 *   keskipäivä (vuoden päivä): 3 merivuotta 153 (2.6.), 2 merivuotta 167 (16.6.), kossit 181 (30.6.)
 *     [L49: kaksivuotiaiden istutuslohien keskimääräinen saalispäivä Suomen rannikolla 167; järjestys 14 vrk:n välein; K]
 *   keskihajonta 17 vrk [L49: 16,0–18,2 vrk; K]
 *   luonnonlohikorjaus 0 vrk. [L49] luonnonlohet pyydettiin mediaaniltaan 8,1 vrk ennen istutettuja, mutta kesän 2025
 *     Kattilakoski [L61: monimerivuotisten huippu 24.–26.6., kossien 17.–20.7.] sopii paremmin ilman korjausta [K]:
 *     2MV 167 + jokisuulle ~5–12 vrk + jokeen ~100 km → ~175–182 (huippu havaittu 175–177); korjauksella 8 vrk liian aikaisin.
 *   lämpösiirto −4,6 vrk/°C huhtikuun pintalämmön poikkeamasta Etelä-Itämerellä (Trelleborg–Sassnitz) [L49 kerroin;
 *     poikkeama vuosien 2016–2025 keskiarvosta, satelliitti DMI L4 → nykyvuoden "tavallinen" on taulukon päivämäärä A]
 *   Ennen kuluvan vuoden huhtikuun dataa käytetään viimeisintä huhtikuuta (Hannu 17.11.: "käytetään tämän vuoden arvoja
 *   alkuun, kunnes aika on oikea").
 * RISKIT [A]: parametrit 1974–92-aineistosta (Ruotsin istutuskannat), "Suomen rannikko" on keskiarvo eikä Luoto;
 *   kalibrointi omilla ja kavereiden saaliilla (päivä, pituus, paino) kesällä 2027.
 */
(function (root) {
  'use strict';
  const IKALUOKAT = [
    { tunnus: '3MV', nimi: '3 merivuotta', lyhyt: '3MV', keski: 153 },
    { tunnus: '2MV', nimi: '2 merivuotta', lyhyt: '2MV', keski: 167 },
    { tunnus: 'kossi', nimi: 'kossit (1 merivuosi)', lyhyt: 'kossit', keski: 181 },
  ];
  const HAJONTA = 17, LUONNONLOHI = 0, KERROIN = 4.6, VERTAILU = [2016, 2025], KAUSI = ['05-01', '08-31'];
  /** Ikäluokkien osuudet: Tornionjoki 2025 [L61 biologinen selvitys 25.2.2026, taulukko 2.1 ja s. 11–12]. Päivitetään,
   *  kun vuoden 2027 selvitys ilmestyy (tammi–helmikuu). */
  const OSUUDET = {
    lahde: 'Tornionjoki 2025 (Luke/SLU biologinen selvitys 2026)',
    kaiku: { kossi: 14585, msw: 30458, yht: 45043 },          // Kattilakoski kaikuluotaus, kpl
    suomu: { kossi: 0.28, '2MV': 0.43 },                      // jokisaaliin suomunäytteet; loput (≥3 merivuotta) ei lukuna
  };

  /** Normaalijakauman kertymäfunktio (Abramowitz & Stegun 7.1.26, virhe < 1,5e-7). */
  function phi(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }
  /** Päivä Suomen ajassa (Europe/Helsinki, kesäaika mukana): { vuosi, kk, pv, vpv (vuoden päivä 1–366) }. */
  let muoto = null;
  function paiva(t) {
    let v, kk, pv;
    try {
      muoto = muoto || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' });
      [v, kk, pv] = muoto.format(t).split('-').map(Number);
    } catch (e) { const d = new Date(t.getTime() + 3 * 3600000); v = d.getUTCFullYear(); kk = d.getUTCMonth() + 1; pv = d.getUTCDate(); }
    return { vuosi: v, kk, pv, vpv: Math.round((Date.UTC(v, kk - 1, pv) - Date.UTC(v, 0, 1)) / 86400000) + 1 };
  }
  /** Vuoden päivä → Date (klo 12 UTC). */
  function paivaksi(vuosi, vpv) { return new Date(Date.UTC(vuosi, 0, 1, 12) + (vpv - 1) * 86400000); }
  /** Kauden vuosi: syyskuusta alkaen seuraava kausi. */
  function kausiVuosi(t) { const p = paiva(t); return p.kk >= 9 ? p.vuosi + 1 : p.vuosi; }

  /** Lämpösiirto vuodelle: { vrk, T, vuosi (käytetty huhtikuu), ref, n, poikkeama } tai { vrk: 0 } jos dataa ei ole.
   *  huhtikuu = { "2016": 4.1 tai { T: 4.1, … }, … } (°C). Käytetään kauden vuoden huhtikuuta tai viimeisintä sitä
   *  aiempaa (Hannu 17.11.2026). Vertailujaksosta (2016–2025) pitää olla vähintään 3 vuotta. */
  function siirto(huhtikuu, vuosi) {
    const arvo = v => { const x = (huhtikuu || {})[v]; return x && typeof x === 'object' ? x.T : x; };
    huhtikuu = Object.fromEntries(Object.keys(huhtikuu || {}).map(v => [v, arvo(v)]).filter(([, T]) => typeof T === 'number' && isFinite(T)));
    const vuodet = Object.keys(huhtikuu).map(Number).sort((a, b) => a - b);
    const ref = vuodet.filter(v => v >= VERTAILU[0] && v <= VERTAILU[1]);
    const kaytto = vuodet.filter(v => v <= vuosi).pop();
    if (kaytto === undefined || ref.length < 3) return { vrk: 0, T: NaN, vuosi: null, ref: NaN, n: ref.length };
    const r = ref.reduce((s, v) => s + huhtikuu[v], 0) / ref.length, T = huhtikuu[kaytto];
    return { vrk: -KERROIN * (T - r), T, vuosi: kaytto, ref: r, n: ref.length, poikkeama: T - r };
  }
  /** Arvio päivälle t: { kausiVuosi, kaudella, siirto, luokat: [{ tunnus, nimi, keski (vpv), puolet (Date), osuus 0–1 }] }. */
  function arvio(t, huhtikuu) {
    const kv = kausiVuosi(t), p = paiva(t), s = siirto(huhtikuu, kv);
    const x = String(p.kk).padStart(2, '0') + '-' + String(p.pv).padStart(2, '0');
    const kaudella = p.vuosi === kv && x >= KAUSI[0] && x <= KAUSI[1];
    const vpv = p.vuosi === kv ? p.vpv : 0;   // ennen kautta (syys–joulukuu) → 0 %
    const luokat = IKALUOKAT.map(L => {
      const mu = L.keski + LUONNONLOHI + s.vrk;
      return Object.assign({}, L, { mu, puolet: paivaksi(kv, Math.round(mu)), osuus: vpv ? phi((vpv - mu) / HAJONTA) : 0 });
    });
    return { kausiVuosi: kv, kaudella, siirto: s, luokat, hajonta: HAJONTA };
  }
  /** Kertymäkäyrät piirtoa varten: päivät alku–loppu (vpv), askel 1 vrk → [{ vpv, osuudet: [3MV, 2MV, kossi] }]. */
  function kayrat(kv, huhtikuu, alku, loppu) {
    const s = siirto(huhtikuu, kv), out = [];
    for (let d = alku; d <= loppu; d++) out.push({ vpv: d, osuudet: IKALUOKAT.map(L => phi((d - (L.keski + LUONNONLOHI + s.vrk)) / HAJONTA)) });
    return out;
  }

  const Ikaluokat = { IKALUOKAT, HAJONTA, LUONNONLOHI, KERROIN, VERTAILU, KAUSI, OSUUDET, phi, paiva, paivaksi, kausiVuosi, siirto, arvio, kayrat };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ikaluokat; else root.Ikaluokat = Ikaluokat;
})(typeof window !== 'undefined' ? window : this);
