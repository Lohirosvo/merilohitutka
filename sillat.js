/* Merilohitutka – sillat.js (v35, 15.11.2026; v37 merikartan luvut)
 * Siltojen alikulkukorkeudet ja meriveden korkeus (Hannu 15.11.: "Lisätään tiedot koordinaatteihin
 * alikulkukorkeuksien kanssa. Vedenkorkeus huomioiden ja kartta tieto korkeus").
 *
 * TODELLINEN ALIKULKU = merkitty alikulku + vertaustason korkeus N2000:ssa − meriveden korkeus nyt N2000:ssa.
 *   Merkitty alikulku on vertaustasosta (MW2005 tai N60+0,1), eikä siihen sisälly vedenkorkeuden vaihtelu.
 *
 * LÄHTEET JA VARMUUS
 *   - Korkeudet: 2005-taulukko (Liikennevirasto 42/2017, liite 9) tai merikartta (Hannun kuvat 15.11.). Merikartan luku on
 *     ensisijainen. Jos kartan vertaustasoa ei tiedetä, oletetaan N2000 (= 0): varovaisin, koska keskivesi on ollut N2000:n
 *     yläpuolella (MW2005 +13,7 cm, 2026 noin +5 cm) – oletus antaa pienimmän alikulun.
 *   - v37: Sundom kartassa 2,5 m (taulukossa 2,4 m MW2005 = 2,54 m N2000 → kartta luultavasti N2000; v35 laski 2,5 m
 *     MW2005:stä = 10–14 cm liikaa). Skalöfjärden kartassa 2,3 m (taulukossa 2,8 m MW2005 – ristiriita, kartta käytössä).
 *     Jos taulukko antaa pienemmän alapinnan kuin kartta, käytetään pienempää.
 *   - Sijainnit: Hannun antamat koordinaatit (asteet-minuutit-sekunnit → desimaalit).
 *   - MW2005 = N2000 + 13,7 cm: Ilmatieteen laitos, muunnosluvut (esimerkki Pietarsaaresta). Vaasan alueen silloille
 *     sama luku on ARVIO (Pietarsaaren ja Vaasan teoreettinen keskivesi N2000:ssa vuonna 2026 sama 5 cm IL:n
 *     varoitustaulukoissa ja maannousu lähes sama; ero arviolta ±2 cm).
 *   - N60+0,1 = N2000 + 54 cm: LASKETTU IL:n luvuista (Pietarsaari MW2005: +13,7 cm N2000, −30,3 cm N60 → N60:n nolla
 *     = N2000 + 44,0 cm). Hannu 15.11.: Fårholmsbro ja Gertrudsbro ajetaan meren puolelta, joten merivesi pätee.
 *   - Mareografit (fmisid, sijainti): Ilmatieteen laitoksen havaintoasemat.
 *   - Ei navigointiin: tarkista silta paikan päällä (korkeusmerkki), aallokko nostaa ja laskee venettä.
 */
(function (root) {
  'use strict';

  const MAREOGRAFIT = [
    { fmisid: '134250', nimi: 'Pietarsaari', lat: 63.70857, lon: 22.68958 },
    { fmisid: '134223', nimi: 'Vaasa', lat: 63.08150, lon: 21.57118 },
    { fmisid: '134251', nimi: 'Kaskinen', lat: 62.34395, lon: 21.21483 },
    { fmisid: '134266', nimi: 'Pori', lat: 61.59438, lon: 21.46343 },
    { fmisid: '134252', nimi: 'Föglö', lat: 60.031883, lon: 20.384817 }
  ];

  /** Vertaustasot N2000:ssa (m). */
  const VERTAUS = {
    'MW2005': { n2000: 0.137, selite: 'MW2005 = N2000 + 13,7 cm (IL, Pietarsaari)' },
    'N60+0,1': { n2000: 0.540, selite: 'N60 + 0,1 m = N2000 + 54 cm (laskettu IL:n luvuista, Pietarsaari)' },
    'N2000': { n2000: 0, selite: 'N2000' }
  };

  const LAHDE = '2005-taulukko (Liikennevirasto 42/2017, liite 9)', KARTTA = 'merikartta (Hannun kuva 15.11.)';
  const SILLAT = [
    { tunnus: 'V-608', nimi: 'Fårholmsbro', lat: 63.697592, lon: 22.758483, korkeus: 3.3, vertaus: 'N60+0,1', lahde: LAHDE },
    { tunnus: 'V-600', nimi: 'Gertrudsbro', lat: 63.798017, lon: 22.763206, korkeus: 3.2, vertaus: 'N60+0,1', lahde: LAHDE },
    { tunnus: 'V-1777', nimi: 'Öskatan silta', lat: 63.259800, lon: 22.079183, korkeus: 3.8, vertaus: 'MW2005', lahde: LAHDE },
    { tunnus: 'V-1234', nimi: 'Hällnäsbro', lat: 63.270883, lon: 22.237114, korkeus: 3.1, vertaus: 'MW2005', lahde: LAHDE },
    { tunnus: 'V-1359', nimi: 'Sundomin silta', lat: 63.079789, lon: 21.576594, korkeus: 2.5, vertaus: 'N2000', oletettu: true,
      taulukko: { korkeus: 2.4, vertaus: 'MW2005' }, lahde: KARTTA + '; ' + LAHDE + ' 2,4 m' },
    { tunnus: 'V-679', nimi: 'Molpeströmsbro', lat: 62.865925, lon: 21.240422, korkeus: 2.5, vertaus: 'MW2005', lahde: LAHDE },
    { tunnus: 'V-675', nimi: 'Skalöfjärdenin silta', lat: 63.274097, lon: 21.343825, korkeus: 2.3, vertaus: 'N2000', oletettu: true,
      taulukko: { korkeus: 2.8, vertaus: 'MW2005' }, lahde: KARTTA + ' (Hannu: "korjataan 2.3 m"); ' + LAHDE + ' 2,8 m' },
    // v37: Hannun merikarttakuvat 15.11. (nimi kartan paikannimestä; varsinaista sillan nimeä ei tiedetä)
    { tunnus: null, nimi: 'Silta Störgrund', lat: 62.992711, lon: 21.472828, korkeus: 2.5, vertaus: 'N2000', oletettu: true, lahde: KARTTA,
      huom: 'noin 2 km Åminnen lähtöpisteestä pohjoiseen' },
    { tunnus: null, nimi: 'Silta Bässörsbottnen', lat: 63.020686, lon: 21.443467, korkeus: 2.5, vertaus: 'N2000', oletettu: true, lahde: KARTTA }
  ];

  function etaisyysKm(a, b, c, d) {
    const r = x => x * Math.PI / 180;
    const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function lahinMareografi(lat, lon) {
    let paras = null;
    for (const m of MAREOGRAFIT) { const km = etaisyysKm(lat, lon, m.lat, m.lon); if (!paras || km < paras.km) paras = Object.assign({ km }, m); }
    return paras;
  }

  function vertausN2000(s) { const v = VERTAUS[s.vertaus]; return v ? v.n2000 : NaN; }

  /** Sillan alapinta N2000:ssa (m): merkitty + vertaustaso; jos taulukon luku antaa pienemmän, se (varovaisempi). */
  function alapinta(s) {
    const k = s.korkeus + vertausN2000(s);
    return s.taulukko ? Math.min(k, s.taulukko.korkeus + vertausN2000(s.taulukko)) : k;
  }

  /** Todellinen alikulku (m), kun meriveden korkeus on vesiN2000 (m). */
  function alikulku(s, vesiN2000) { return isFinite(vesiN2000) ? alapinta(s) - vesiN2000 : NaN; }

  /** 'mahtuu' | 'ei' | 'tuntematon' (ei vedenkorkeutta). */
  function tila(ak, vene, vara) {
    if (!isFinite(ak) || !isFinite(vene)) return 'tuntematon';
    return ak >= vene + (vara || 0) - 1e-9 ? 'mahtuu' : 'ei';
  }

  // ---------------------------------------------------------------- FMI-vastausten tulkinta
  // Havainto (fmi::observations::mareograph::instant): WATLEV = teoreettisesta keskivedestä, WLEVN2K_PT1S_INSTANT = N2000,
  // millimetreinä (IL: "Sea water level referred to the theoretical mean water or N2000-system in millimeters").
  // Ennusteen (fmi::forecast::sealevel::point) parametrien nimiä ja yksikköä ei ole tarkistettu: nimi valitaan
  // sisällön mukaan (N2000 / N2K → N2000, muuten keskivesi) ja yksikkö (mm vai cm) havaintoon vertaamalla.
  const onN2000 = n => /N2K|N2000/i.test(n);
  const onVesi = n => /WATLEV|WLEV|SEALEV|SEA_?LEVEL|WATERLEVEL/i.test(n) && !/TEMP|^TW/i.test(n);

  function parametrit(rivit) {
    const nimet = [...new Set(rivit.map(r => r.param))];
    return { n2000: nimet.find(n => onN2000(n)) || null, mw: nimet.find(n => onVesi(n) && !onN2000(n)) || null, nimet };
  }

  /** Rivit [{aika, param, arvo}] → aikasarja [{t: Date, n2000: m, mw: m}] (jakaja: mm → 1000). */
  function sarjaksi(rivit, jakaja = 1000) {
    const p = parametrit(rivit), map = new Map();
    for (const r of rivit) {
      if (!isFinite(r.arvo)) continue;
      const k = r.aika.getTime();
      if (!map.has(k)) map.set(k, { t: r.aika, n2000: NaN, mw: NaN });
      if (r.param === p.n2000) map.get(k).n2000 = r.arvo / jakaja;
      else if (r.param === p.mw) map.get(k).mw = r.arvo / jakaja;
    }
    return Array.from(map.values()).filter(r => isFinite(r.n2000) || isFinite(r.mw)).sort((a, b) => a.t - b.t);
  }

  /** Havaintorivit → { t, n2000, mw, parametrit } (viimeisin, jossa N2000; muuten viimeisin keskivesi) tai null. */
  function havainto(rivit) {
    const s = sarjaksi(rivit), p = parametrit(rivit);
    for (let i = s.length - 1; i >= 0; i--) if (isFinite(s[i].n2000)) return Object.assign({ parametrit: p }, s[i]);
    return s.length ? Object.assign({ parametrit: p }, s[s.length - 1]) : null;
  }

  /** Ennusterivit → { sarja: [{t, n2000}], yksikko: 'mm'|'cm', arvattu: bool, muunnettu: bool, parametrit }.
   *  hav = havainto() (yksikön tarkistus ja keskivesi → N2000 -ero). */
  function ennuste(rivit, hav) {
    const p = parametrit(rivit);
    let jakaja = 1000, arvattu = true;
    if (hav) {
      const vert = (s, k) => {   // ennusteen arvo lähinnä havaintohetkeä (±90 min) samassa järjestelmässä
        let paras = null;
        for (const r of s) { const dt = Math.abs(r.t - hav.t); if (dt <= 90 * 60000 && isFinite(r[k]) && (!paras || dt < paras.dt)) paras = { dt, v: r[k] }; }
        return paras;
      };
      const k = isFinite(hav.n2000) && p.n2000 ? 'n2000' : 'mw';
      const raa = sarjaksi(rivit, 1), v = vert(raa, k);
      if (v && isFinite(hav[k])) {
        const eroMm = Math.abs(v.v / 1000 - hav[k]), eroCm = Math.abs(v.v / 100 - hav[k]);
        jakaja = eroCm < eroMm ? 100 : 1000; arvattu = false;
      }
    }
    let muunnettu = false;
    const ero = hav && isFinite(hav.n2000) && isFinite(hav.mw) ? hav.n2000 - hav.mw : NaN;
    const sarja = sarjaksi(rivit, jakaja).map(r => {
      if (isFinite(r.n2000)) return { t: r.t, n2000: r.n2000 };
      if (isFinite(r.mw) && isFinite(ero)) { muunnettu = true; return { t: r.t, n2000: r.mw + ero }; }
      return { t: r.t, n2000: NaN };
    }).filter(r => isFinite(r.n2000));
    return { sarja, yksikko: jakaja === 100 ? 'cm' : 'mm', arvattu, muunnettu, parametrit: p };
  }

  /** Vedenkorkeus hetkellä t ennustesarjasta (lineaarinen) – NaN, jos t on sarjan ulkopuolella yli 90 min. */
  function arvoHetkella(sarja, t) {
    if (!sarja || !sarja.length) return NaN;
    const ms = +t;
    if (ms <= sarja[0].t) return ms >= sarja[0].t - 90 * 60000 ? sarja[0].n2000 : NaN;
    for (let i = 1; i < sarja.length; i++) if (ms <= sarja[i].t) {
      const a = sarja[i - 1], b = sarja[i], f = (ms - a.t) / (b.t - a.t);
      return a.n2000 + f * (b.n2000 - a.n2000);
    }
    const l = sarja[sarja.length - 1];
    return ms <= +l.t + 90 * 60000 ? l.n2000 : NaN;
  }

  /** Ennusteen osa [alku, alku + tunnit]: [{t, n2000}]. */
  function jakso(sarja, alku, tunnit = 12) {
    const a = +alku, b = a + tunnit * 3600000;
    return (sarja || []).filter(r => r.t >= a - 60000 && r.t <= b + 60000);
  }

  /** Sillan arvio: nyt (havainto) ja 12 h ennusteen pienin/suurin alikulku. */
  function arvio(s, vesi, vene, vara, nyt) {
    const v = vesi && vesi.havainto && isFinite(vesi.havainto.n2000) ? vesi.havainto.n2000 : NaN;
    const ak = alikulku(s, v);
    const tulos = { silta: s, vesi: v, alikulku: ak, tila: tila(ak, vene, vara), ero: isFinite(ak) && isFinite(vene) ? ak - vene - (vara || 0) : NaN,
      pienin: null, suurin: null };
    const ennS = vesi && vesi.ennuste ? jakso(vesi.ennuste.sarja, nyt || new Date(), 12) : [];
    tulos.eiMahdu = null;   // ennusteen ensimmäinen hetki, jolloin vene ei mahdu
    for (const r of ennS) {
      const a = alikulku(s, r.n2000);
      if (!tulos.pienin || a < tulos.pienin.m) tulos.pienin = { m: a, t: r.t };
      if (!tulos.suurin || a > tulos.suurin.m) tulos.suurin = { m: a, t: r.t };
      if (!tulos.eiMahdu && tila(a, vene, vara) === 'ei') tulos.eiMahdu = { m: a, t: r.t };
    }
    return tulos;
  }

  /** Lähin silta pisteestä (enintään rajaM metriä): { silta, m } tai null. */
  function lahinSilta(lat, lon, rajaM = 400) {
    let paras = null;
    for (const s of SILLAT) { const m = etaisyysKm(lat, lon, s.lat, s.lon) * 1000; if (m <= rajaM && (!paras || m < paras.m)) paras = { silta: s, m }; }
    return paras;
  }

  const Sillat = { SILLAT, MAREOGRAFIT, VERTAUS, etaisyysKm, lahinMareografi, vertausN2000, alapinta, alikulku, tila, parametrit, sarjaksi,
                   havainto, ennuste, arvoHetkella, jakso, arvio, lahinSilta };
  if (typeof module !== 'undefined' && module.exports) module.exports = Sillat;
  else root.Sillat = Sillat;
})(typeof window !== 'undefined' ? window : this);
