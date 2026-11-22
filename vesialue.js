/* Merilohitutka – vesialue.js (v69, 22.11.2026)
 * Yleinen vesialue (ulappa): koeajo v2 PUHELIMESSA. Ei piirrä vielä mitään kartalle; tulos on teksti, jonka Hannu kopioi
 * keskusteluun.
 *
 * Tausta: koeajo v1 (Actions, koe_vesialueet.py, MML INSPIRE Cadastral Parcels WFS ilman avainta, 22.11.2026) löysi palstoja
 * vain maalta; kaikki merelliset pisteet tyhjiä, myös Luodon lahti → INSPIRE-tuotteessa ei ole vesialueita [K].
 * Tämä koe: MML Kiinteistötietojen kyselypalvelu (OGC API Features), avoimet tuotteet API-avaimella
 * [L maanmittauslaitos.fi/kiinteistotietojen-kyselypalvelu-ogc-api 22.11.2026: API-avainvaihtoehto "Maksuton",
 *  osoite https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3/, kokoelmat
 *  PalstanSijaintitiedot ja KiinteistorajanSijaintitiedot; sama API-avain käy myös maastotietokantaan (MML:n API-avainohje)].
 *
 * AVAIN (Hannu 22.11.2026: "Avain pitäisi olla uistelututkan puolella"): uistelututka tallentaa avaimen vain puhelimeen
 * (localStorage 'uistelututka_mml_avain'). Molemmat sovellukset ovat osoitteessa lohirosvo.github.io, joten samassa selaimessa
 * ne näkevät saman tallennuksen [L: selaimen tallennus on osoitekohtainen (origin)]. Järjestys: oma 'mlt_mml_avain', sitten
 * uistelututkan. Avain ei mene GitHubiin, tulokseen eikä virheteksteihin (peita()).
 *
 * KYSELYT: kokoelmalista ja palstan kentät (queryables) kerran; jokaisessa koepisteessä palstat ±50 m:n laatikosta (bbox CRS84,
 * OGC API Features -oletus) ja kiinteistörajat ±1 km:n laatikosta (limit 3: riittää kertomaan, onko rajoja). Piste, joka on jo
 * haetun palstan sisällä, ei kysy palstaa uudelleen (iso vesialuepalsta voi olla megatavuja). Tauko 300 ms kutsujen välissä.
 *
 * TULKINTA: [L] kiinteistötunnuksen ryhmänumero 876 = yhteinen vesialue (esim. 86-402-876-2 "Haminan kylän yhteinen vesialue",
 * MML:n toimitusasiakirja). Yleisen vesialueen tunnusmuotoa ei ole tarkistettu [A] → tulos näyttää tunnukset ja kentät sellaisinaan.
 * Rajapinnan kenttien nimiä ei ole tarkistettu [A] → tunnus haetaan nimellä kiinteistotunnus, muuten ensimmäinen "tunnus"-kenttä.
 */
(function (root) {
  'use strict';

  const VERSIO = 2;   // koeajon versio (v1 = Actionsin INSPIRE-koe)
  const OSOITE = 'https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3';
  const PALSTA = 'PalstanSijaintitiedot', RAJA = 'KiinteistorajanSijaintitiedot';
  const LS_OMA = 'mlt_mml_avain', LS_UT = 'uistelututka_mml_avain', LS_TULOS = 'mlt_vesialuekoe';
  const PALSTA_M = 50, RAJA_M = 1000, TAUKO_MS = 300, AIKA_MS = 30000;
  const NIMETYT = ['Kolmoispatti', 'Kallan', 'Tankar', 'Norrskär', 'Mikkelinsaaret'];

  // ------------------------------------------------------------ avain
  function puhdista(v) {
    if (typeof v !== 'string') return '';
    let s = v.trim();
    try { const j = JSON.parse(s); if (typeof j === 'string') s = j.trim(); } catch (e) {}
    return s;
  }
  const kelpaa = v => /^[0-9a-z-]{20,}$/i.test(v || '');   // sama tarkistus kuin uistelututkassa
  /** { avain, lahde }: oma ensin, sitten uistelututkan (sama selain). */
  function lueAvain(ls) {
    const hae = k => { try { return puhdista(ls.getItem(k)); } catch (e) { return ''; } };
    const oma = hae(LS_OMA); if (kelpaa(oma)) return { avain: oma, lahde: 'Merilohitutkan oma' };
    const ut = hae(LS_UT); if (kelpaa(ut)) return { avain: ut, lahde: 'uistelututkan avain' };
    return { avain: '', lahde: '' };
  }
  /** Tallentaa oman avaimen (JSON-merkkijonona kuten muutkin mlt_-tallennukset). Palauttaa virhetekstin tai ''. */
  function tallennaAvain(ls, v) {
    const s = puhdista(v);
    if (!kelpaa(s)) return 'Avain näyttää väärältä: siinä pitäisi olla vain kirjaimia, numeroita ja väliviivoja (vähintään 20 merkkiä).';
    try { ls.setItem(LS_OMA, JSON.stringify(s)); } catch (e) { return 'Tallennus epäonnistui: ' + e.message; }
    return '';
  }
  function peita(teksti, avain) {
    let t = String(teksti == null ? '' : teksti);
    if (avain) t = t.split(avain).join('…' + avain.slice(-4));
    return t.replace(/api-key=[^&\s"']+/gi, 'api-key=…');
  }

  // ------------------------------------------------------------ pisteet ja geometria
  const pyor = x => Math.round(x * 1e5) / 1e5;
  /** Samat pisteet kuin koe_vesialueet.koepisteet (v1): 7 pistettä alueen keskileveydellä lännestä itään,
   *  nimetyt merkit ja lähtöpisteet. Vain alueet, joilla on lohirajat (ei Ahvenanmaata). */
  function koepisteet(alueet) {
    const out = [];
    for (const a of alueet || []) {
      if (!a.lohirajat) continue;
      const r = a.rajat;
      const lat = (a.keski || [(r.lat_min + r.lat_max) / 2])[0];
      for (let k = 0; k < 7; k++) out.push({ alue: a.tunnus, nimi: `poikki ${k + 1}/7`, lat: pyor(lat), lon: pyor(r.lon_min + (r.lon_max - r.lon_min) * (k + 0.5) / 7) });
      for (const m of a.merkit || []) if (NIMETYT.includes(m.nimi)) out.push({ alue: a.tunnus, nimi: m.nimi, lat: m.lat, lon: m.lon });
      for (const p of a.lahtopisteet || []) out.push({ alue: a.tunnus, nimi: 'lähtö ' + p.nimi, lat: p.lat, lon: p.lon });
    }
    return out;
  }
  /** bbox CRS84-järjestyksessä (lon,lat,lon,lat), puoli = laatikon puolikas metreinä. */
  function bbox(lat, lon, puoli) {
    const dlat = puoli / 111320, dlon = puoli / (111320 * Math.cos(lat * Math.PI / 180));
    return [lon - dlon, lat - dlat, lon + dlon, lat + dlat].map(x => x.toFixed(6)).join(',');
  }
  function renkaassa(lat, lon, rengas) {   // GeoJSON-rengas [[lon, lat], …]
    let s = false;
    for (let i = 0, j = rengas.length - 1; i < rengas.length; j = i++) {
      const xi = rengas[i][0], yi = rengas[i][1], xj = rengas[j][0], yj = rengas[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) s = !s;
    }
    return s;
  }
  /** Onko piste Polygonin tai MultiPolygonin sisällä (reiät huomioiden). null = muu geometria. */
  function sisalla(lat, lon, g) {
    if (!g || !g.coordinates) return null;
    const monikulmio = P => P.length > 0 && renkaassa(lat, lon, P[0]) && !P.slice(1).some(R => renkaassa(lat, lon, R));
    if (g.type === 'Polygon') return monikulmio(g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some(monikulmio);
    return null;
  }
  function pisteita(g) {
    let n = 0;
    const kay = c => { if (typeof c[0] === 'number') n++; else c.forEach(kay); };
    try { if (g && g.coordinates) kay(g.coordinates); } catch (e) {}
    return n;
  }

  // ------------------------------------------------------------ tunnus ja kentät
  /** 14-numeroinen tunnus (KKKVVVRRRRYYYY) → 499-876-1-0; valmiiksi viivallinen sellaisenaan. */
  function tunnusMuoto(t) {
    const s = String(t == null ? '' : t).trim();
    if (/^\d{14}$/.test(s)) return [s.slice(0, 3), s.slice(3, 6), s.slice(6, 10), s.slice(10)].map(x => String(parseInt(x, 10))).join('-');
    return s;
  }
  function tunnusKentasta(p) {
    if (!p) return '';
    if (p.kiinteistotunnus != null) return tunnusMuoto(p.kiinteistotunnus);
    const k = Object.keys(p).find(x => /tunnus/i.test(x) && !/esitys|id$/i.test(x));
    return k ? tunnusMuoto(p[k]) : '';
  }
  /** Ryhmänumero (kolmas osa): 876 = yhteinen vesialue [L]. */
  function ryhma(tunnus) { const o = String(tunnus).split('-'); return o.length === 4 ? o[2] : ''; }
  function tulkinta(tunnus) { return ryhma(tunnus) === '876' ? 'yhteinen vesialue' : ''; }
  function kentat(p, ohita, pituus) {
    if (!p) return '';
    const osat = [];
    for (const k of Object.keys(p)) {
      if ((ohita || []).includes(k)) continue;
      let v = p[k];
      if (v !== null && typeof v === 'object') v = JSON.stringify(v);
      osat.push(k + '=' + String(v).slice(0, 40));
    }
    return osat.join('; ').slice(0, pituus || 220);
  }

  // ------------------------------------------------------------ haku
  async function haeOletus(url) {
    const ohjain = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const ajastin = ohjain ? setTimeout(() => ohjain.abort(), AIKA_MS) : null;
    try {
      const r = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/geo+json, application/json' }, signal: ohjain ? ohjain.signal : undefined });
      let json = null, teksti = '';
      try { teksti = await r.text(); json = JSON.parse(teksti); } catch (e) {}
      return { status: r.status, json, tavut: teksti.length, teksti: json ? '' : teksti.slice(0, 200) };
    } finally { if (ajastin) clearTimeout(ajastin); }
  }
  const odota = ms => new Promise(r => setTimeout(r, ms));
  const osoite = (polku, avain, lisa) => `${OSOITE}/${polku}?${lisa ? lisa + '&' : ''}api-key=${encodeURIComponent(avain)}`;

  /**
   * Koeajo. o: { alueet, avain, avainLahde, hae(url) → {status, json, tavut}, tila(teksti), seis() → true keskeyttää, tauko, nyt }.
   * Palauttaa tulosolion (tulosTeksti() tekee siitä keskusteluun liitettävän tekstin).
   */
  async function aja(o) {
    const hae = o.hae || haeOletus, tila = o.tila || (() => {}), seis = o.seis || (() => false);
    const tauko = o.tauko == null ? TAUKO_MS : o.tauko, avain = o.avain;
    const alku = Date.now();
    const T = { versio: VERSIO, luotu: (o.nyt || new Date()).toISOString(), osoite: OSOITE, avain: o.avainLahde || '',
      kokoelmat: null, kentat: null, pisteet: [], palstat: {}, virheet: [], kutsuja: 0, tavuja: 0, keskeytetty: false, pysahtyi: '' };
    if (!avain) { T.pysahtyi = 'ei avainta'; return T; }
    const pyynto = async (polku, lisa) => {
      if (T.kutsuja) await odota(tauko);
      T.kutsuja++;
      let v;
      try { v = await hae(osoite(polku, avain, lisa)); }
      catch (e) {
        const viesti = e && e.name === 'AbortError' ? `aikaraja ${AIKA_MS / 1000} s` : (e && e.message) || String(e);
        throw Object.assign(new Error(peita(viesti, avain)), { verkko: true });
      }
      T.tavuja += v.tavut || 0;
      if (v.status === 401 || v.status === 403) throw Object.assign(new Error(`HTTP ${v.status} (avain hylätty?)`), { avain: true });
      if (v.status !== 200 || !v.json) throw new Error(peita(`HTTP ${v.status}${v.teksti ? ': ' + v.teksti : ''}`, avain));
      return v.json;
    };
    // 1. kokoelmat ja palstan kentät
    try {
      const j = await pyynto('collections');
      T.kokoelmat = (j.collections || []).map(c => c.id || c.title).filter(Boolean);
      tila(`Kokoelmia ${T.kokoelmat.length}`);
    } catch (e) {
      T.virheet.push('kokoelmat: ' + e.message);
      if (e.verkko || e.avain) { T.pysahtyi = e.verkko ? 'verkkovirhe heti alussa (estääkö selain kutsun? CORS)' : e.message; return T; }
    }
    try {
      const j = await pyynto(`collections/${PALSTA}/queryables`);
      T.kentat = Object.keys(j.properties || {});
    } catch (e) { T.virheet.push('kentät: ' + e.message); }
    // 2. koepisteet
    const haetut = [];   // [{ tunnus, geom }] palstat, joiden sisälle myöhempi piste voi osua
    const pisteet = koepisteet(o.alueet);
    for (let i = 0; i < pisteet.length; i++) {
      if (seis()) { T.keskeytetty = true; break; }
      const p = Object.assign({}, pisteet[i], { palstat: [], rajoja: null });
      tila(`Piste ${i + 1}/${pisteet.length}: ${p.alue} ${p.nimi}`);
      const vanha = haetut.find(h => sisalla(p.lat, p.lon, h.geom));
      if (vanha) p.palstat.push({ tunnus: vanha.tunnus, sis: true, sama: true });
      else {
        try {
          const j = await pyynto(`collections/${PALSTA}/items`, `bbox=${bbox(p.lat, p.lon, PALSTA_M)}&limit=10`);
          for (const f of j.features || []) {
            const tunnus = tunnusKentasta(f.properties) || String(f.id || '?');
            const sis = sisalla(p.lat, p.lon, f.geometry);
            p.palstat.push({ tunnus, sis });
            if (!T.palstat[tunnus]) T.palstat[tunnus] = { kentat: kentat(f.properties, ['kiinteistotunnus']), geom: (f.geometry && f.geometry.type) || '–', pisteita: pisteita(f.geometry) };
            if (sis && f.geometry) haetut.push({ tunnus, geom: f.geometry });
          }
          p.loytyi = j.numberMatched != null ? j.numberMatched : (j.features || []).length;
        } catch (e) {
          p.virhe = 'palstat: ' + e.message; T.virheet.push(`${p.alue} ${p.nimi} ${p.virhe}`);
          if (e.verkko || e.avain) { T.pisteet.push(p); T.pysahtyi = e.message; break; }
        }
      }
      if (seis()) { T.pisteet.push(p); T.keskeytetty = true; break; }
      try {
        const j = await pyynto(`collections/${RAJA}/items`, `bbox=${bbox(p.lat, p.lon, RAJA_M)}&limit=3`);
        const n = (j.features || []).length;
        p.rajoja = j.numberMatched != null ? String(j.numberMatched) : (n >= 3 ? '≥3' : String(n));
        if (n && !T.rajaEsim) T.rajaEsim = kentat(j.features[0].properties, [], 200);
      } catch (e) {
        p.virhe = (p.virhe ? p.virhe + '; ' : '') + 'rajat: ' + e.message; T.virheet.push(`${p.alue} ${p.nimi} rajat: ${e.message}`);
        if (e.verkko || e.avain) { T.pisteet.push(p); T.pysahtyi = e.message; break; }
      }
      T.pisteet.push(p);
    }
    T.kesto_s = Math.round((Date.now() - alku) / 1000);
    T.pisteitaYht = pisteet.length;
    return T;
  }

  // ------------------------------------------------------------ teksti
  function tulosTeksti(T) {
    const r = [];
    r.push(`Vesialuekoe v${T.versio} (puhelin) ${T.luotu.slice(0, 16).replace('T', ' ')} UTC · MML kiinteisto-avoin simple-features v3 · ${T.avain || 'ei avainta'}`);
    if (T.pysahtyi) r.push('PYSÄHTYI: ' + T.pysahtyi);
    if (T.keskeytetty) r.push('KESKEYTETTY käyttäjän toimesta');
    r.push('Kokoelmat: ' + (T.kokoelmat ? T.kokoelmat.join(', ') : '–'));
    r.push('Palstan kentät: ' + (T.kentat ? T.kentat.join(', ') : '–'));
    r.push(`Pisteet ${T.pisteet.length}/${T.pisteitaYht || T.pisteet.length} (palstat ±${PALSTA_M} m, rajat ±${RAJA_M / 1000} km; * = piste palstan sisällä, = = sama kuin aiempi):`);
    for (const p of T.pisteet) {
      const pal = p.palstat.length
        ? p.palstat.map(x => x.tunnus + (x.sama ? '=' : x.sis ? '*' : '') + (tulkinta(x.tunnus) ? ' (' + tulkinta(x.tunnus) + ')' : '')).join(', ')
        : (p.virhe && /palstat/.test(p.virhe) ? '?' : '0');
      r.push(`${p.alue} ${p.nimi} ${p.lat.toFixed(5)},${p.lon.toFixed(5)}: palstat ${pal} · rajoja ${p.rajoja == null ? '?' : p.rajoja}${p.virhe ? ' · VIRHE ' + p.virhe : ''}`);
    }
    const tunnukset = Object.keys(T.palstat);
    const sis = T.pisteet.filter(p => p.palstat.some(x => x.sis)).length, ei = T.pisteet.filter(p => !p.palstat.length && !p.virhe).length;
    const ryhmat = {};
    for (const t of tunnukset) { const g = ryhma(t) || '?'; ryhmat[g] = (ryhmat[g] || 0) + 1; }
    r.push(`Yhteenveto: piste palstan sisällä ${sis}, ei palstaa ${ei}; eri palstoja ${tunnukset.length}; ryhmänumerot ` +
      Object.keys(ryhmat).sort().map(g => `${g}×${ryhmat[g]}`).join(', '));
    if (tunnukset.length) {
      r.push('Palstat (kentät, geometria):');
      for (const t of tunnukset.slice(0, 40)) { const x = T.palstat[t]; r.push(`  ${t}: ${x.kentat || '–'} · ${x.geom} ${x.pisteita} p.`); }
      if (tunnukset.length > 40) r.push(`  … ${tunnukset.length - 40} lisää`);
    }
    if (T.rajaEsim) r.push('Rajan kentät (esimerkki): ' + T.rajaEsim);
    if (T.virheet.length) r.push('Virheet: ' + T.virheet.slice(0, 12).join(' | ') + (T.virheet.length > 12 ? ` (+${T.virheet.length - 12})` : ''));
    r.push(`Kutsuja ${T.kutsuja}, ${(T.tavuja / 1e6).toFixed(1)} Mt, kesto ${T.kesto_s == null ? '–' : T.kesto_s + ' s'}`);
    return r.join('\n');
  }

  const Vesialue = { VERSIO, OSOITE, LS_OMA, LS_UT, LS_TULOS, lueAvain, tallennaAvain, kelpaa, peita, koepisteet, bbox, sisalla,
    pisteita, tunnusMuoto, tunnusKentasta, ryhma, tulkinta, kentat, aja, tulosTeksti };
  if (typeof module !== 'undefined' && module.exports) module.exports = Vesialue; else root.Vesialue = Vesialue;
})(typeof window !== 'undefined' ? window : this);
