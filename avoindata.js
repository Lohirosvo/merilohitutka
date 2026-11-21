/* Merilohitutka – avoindata.js (v62, 21.11.2026)
 * Hannu 21.11.2026: "1 3 6 tehdään" (avoimen datan lista): 1 IL:n merivaroitukset, 3 IL:n poijujen mitattu aallonkorkeus
 * ja vedenlämpö, 6 turvalaitteiden viat (Digitraffic). Tässä puhtaat jäsennys- ja valintafunktiot (testattavissa Nodessa);
 * haku ja näyttö index.html:ssä.
 *
 * 1. Varoitukset [L, alerts.fmi.fi CAP-syöte 21.11.2026]: Atom-syöte https://alerts.fmi.fi/cap/feed/atom_fi-FI.xml, jokainen
 *    entry sisältää CAP 1.2 alertin; info (fi-FI, sv-FI, en-GB): event, eventCode (esim. seaWind), onset, expires, headline,
 *    description, parameter (color, windIntensity, windDirection, probability, typicalImpacts), area (areaDesc, polygon
 *    "lat,lon lat,lon …", geocode METAREA esim. B2 = Merenkurkku).
 * 3. Poijut [L, IL:n WFS-ohje]: fmi::observations::wave::* ("Wave and Water temperature observations"), aallonkorkeus WaveHs.
 *    Vedenlämmön parametrin nimeä ohje ei kerro [A] → tunnistetaan nimestä (TWATER, TW…).
 * v63 (Hannu 21.11.2026 "2 4 5"): 4. salamat [L: IL:n kysely fmi::observations::lightning::simple (fmiopendata, rOpenGov fmi);
 *    kentät cloud_indicator (0 maa, 1 pilvi), peak_current, multiplicity, ellipse_major]. Sadetutka ei: IL:n WMS:n suora käyttö
 *    sovelluksessa ei ole sallittu ja S3:n GeoTIFF-muotoa ei ole tarkistettu.
 * 6. Viat [L, Digitraffic]: https://meri.digitraffic.fi/api/aton/v1/faults "Return all active faults in GeoJSON". Kenttien
 *    nimiä ei ole vahvistettu [A] → haetaan avaimen nimen perusteella.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ yhteiset
  function tagi(xml, nimi) {
    const m = xml.match(new RegExp('<(?:[\\w-]+:)?' + nimi + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?' + nimi + '>'));
    return m ? pura(m[1].trim()) : null;
  }
  function kaikki(xml, nimi) {
    const re = new RegExp('<(?:[\\w-]+:)?' + nimi + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?' + nimi + '>', 'g'), out = [];
    let m; while ((m = re.exec(xml))) out.push(m[1]);
    return out;
  }
  function pura(s) {
    return s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  }

  // ------------------------------------------------------------ 1. varoitukset
  const TASO = { red: 3, orange: 2, yellow: 1 };
  const VARI_FI = { red: 'punainen', orange: 'oranssi', yellow: 'keltainen' };
  /** Atom/CAP-teksti → [{ id, tapahtuma, koodi, vari, taso, otsikko, kuvaus, vaikutus, alku, loppu, tuuli, suunta, tod, alueet }]. */
  function jasennaCap(xml) {
    const out = [];
    for (let entry of kaikki(xml, 'entry').concat(kaikki(xml, 'alert').length && !/<(?:\w+:)?entry\b/.test(xml) ? [xml] : [])) {
      if (/&lt;(?:\w+:)?alert\b/.test(entry)) entry = pura(entry);   // CAP tekstinä (escaped) eikä XML:nä
      const alerts = kaikki(entry, 'alert');
      for (const a of (alerts.length ? alerts : [entry])) {
        const infot = kaikki(a, 'info');
        const info = infot.find(i => /<(?:\w+:)?language>\s*fi/i.test(i)) || infot[0];
        if (!info) continue;
        const p = {};
        for (const par of kaikki(info, 'parameter')) { const n = tagi(par, 'valueName'), v = tagi(par, 'value'); if (n) p[n] = v; }
        const alueet = kaikki(info, 'area').map(ar => ({
          nimi: tagi(ar, 'areaDesc') || '', koodi: tagi(ar, 'value') || '',
          polygon: (tagi(ar, 'polygon') || '').replace(/"/g, '').trim().split(/\s+/).map(s => s.split(',').map(Number)).filter(q => q.length >= 2 && isFinite(q[0]) && isFinite(q[1])),
        }));
        const ec = kaikki(info, 'eventCode').map(e => tagi(e, 'value')).filter(Boolean);
        const vari = (p.color || '').toLowerCase();
        out.push({ id: tagi(a, 'identifier') || tagi(entry, 'id') || '', tapahtuma: (tagi(info, 'event') || '').replace(/"/g, ''),
          koodi: ec[0] || '', vari, taso: TASO[vari] || 0, otsikko: (tagi(info, 'headline') || '').replace(/^"|"$/g, ''),
          kuvaus: (tagi(info, 'description') || '').replace(/^"|"$/g, ''), vaikutus: (p.typicalImpacts || '').replace(/^"|"$/g, ''),
          alku: tagi(info, 'onset') || tagi(info, 'effective') || tagi(a, 'sent') || null, loppu: tagi(info, 'expires') || null,
          tuuli: isFinite(parseFloat(p.windIntensity)) ? parseFloat(p.windIntensity) : null,
          suunta: isFinite(parseFloat(p.windDirection)) ? parseFloat(p.windDirection) : null,
          tod: isFinite(parseFloat(p.probability)) ? parseFloat(p.probability) : null, alueet });
      }
    }
    return out;
  }
  /** Merta koskeva varoitus: eventCode sea… tai tapahtuma "…merelle" / aallokko. */
  function onMerella(v) { return /^sea/i.test(v.koodi || '') || /merelle|aallokko|havet|sea/i.test(v.tapahtuma || ''); }
  function pisteMonikulmiossa(lat, lon, poly) {
    let sisalla = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) sisalla = !sisalla;
    }
    return sisalla;
  }
  function leikkaa(p1, p2, p3, p4) {   // janat p1–p2 ja p3–p4 ([lat, lon])
    const r = (a, b, c) => (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const d1 = r(p3, p4, p1), d2 = r(p3, p4, p2), d3 = r(p1, p2, p3), d4 = r(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  /** Osuuko varoituksen jokin alue sovelluksen alueen rajoihin (laatikko)? Kulma tai keskikohta monikulmiossa, monikulmion
   *  kärki laatikossa tai reunat leikkaavat. */
  function koskeeAluetta(v, rajat) {
    if (!rajat) return false;
    const { lat_min: a, lat_max: b, lon_min: c, lon_max: d } = rajat;
    const kulmat = [[a, c], [a, d], [b, d], [b, c]], laatikko = kulmat.concat([[(a + b) / 2, (c + d) / 2]]);
    return (v.alueet || []).some(ar => {
      const P = ar.polygon;
      if (P.length < 3) return false;
      if (laatikko.some(([la, lo]) => pisteMonikulmiossa(la, lo, P)) || P.some(([la, lo]) => la >= a && la <= b && lo >= c && lo <= d)) return true;
      for (let i = 0; i < P.length; i++) for (let k = 0; k < 4; k++) if (leikkaa(P[i], P[(i + 1) % P.length], kulmat[k], kulmat[(k + 1) % 4])) return true;
      return false;
    });
  }
  /** Voimassa nyt tai alkaa `tunnit` sisällä; järjestys: vakavin, sitten aikaisin. */
  function valitse(varoitukset, rajat, t, tunnit = 48) {
    const nyt = t.getTime(), raja = nyt + tunnit * 3600e3;
    return (varoitukset || []).filter(v => onMerella(v) && koskeeAluetta(v, rajat)
      && (!v.loppu || Date.parse(v.loppu) > nyt) && (!v.alku || Date.parse(v.alku) <= raja))
      .map(v => Object.assign({}, v, { voimassa: !v.alku || Date.parse(v.alku) <= nyt }))
      .sort((x, y) => (y.voimassa - x.voimassa) || (y.taso - x.taso) || (Date.parse(x.alku || 0) - Date.parse(y.alku || 0)));
  }
  /** Syötteen oma päivitysaika (Atom feed > updated, ennen ensimmäistä entryä). */
  function syoteAika(xml) {
    const alku = String(xml || '').split(/<(?:\w+:)?entry\b/)[0], a = tagi(alku, 'updated');
    const d = a ? new Date(a) : null;
    return d && !isNaN(d) ? d : null;
  }
  function varoitusTeksti(v) {
    return (v.otsikko || ((VARI_FI[v.vari] ? VARI_FI[v.vari] + ' ' : '') + v.tapahtuma)) + (v.tuuli !== null ? ` · ${String(v.tuuli).replace('.', ',')} m/s` : '');
  }

  // ------------------------------------------------------------ 3. poijut
  const HS = /^(wavehs|hs|sigwaveheight)$/i, VESI = /^(twater|tw|watertemp|tempwater|tw_pt1h_avg)$/i;
  function matka(la1, lo1, la2, lo2) {
    const r = Math.PI / 180, x = (lo2 - lo1) * r * Math.cos((la1 + la2) / 2 * r), y = (la2 - la1) * r;
    return 6371 * Math.hypot(x, y);
  }
  function suuntaSana(la1, lo1, la2, lo2) {
    const k = (Math.atan2((lo2 - lo1) * Math.cos(la1 * Math.PI / 180), la2 - la1) * 180 / Math.PI + 360) % 360;
    return ['P', 'KO', 'I', 'KA', 'E', 'LO', 'L', 'LU'][Math.round(k / 45) % 8];
  }
  /** FMI simple- tai tvp-rivit [{lat, lon, aika, param, arvo, nimi?}] → poijut lähimmästä alkaen: [{ lat, lon, nimi, km, suunta, aika, hs, vesi, muut }]. */
  function poijut(rivit, lat, lon, max = 3) {
    const ryhmat = new Map();
    for (const r of rivit || []) {
      if (!isFinite(r.arvo)) continue;
      const k = r.lat.toFixed(4) + ',' + r.lon.toFixed(4);
      if (!ryhmat.has(k)) ryhmat.set(k, { lat: r.lat, lon: r.lon, nimi: r.nimi || null, viimeisin: {} });
      const g = ryhmat.get(k), aika = r.aika instanceof Date ? r.aika : new Date(r.aika);
      if (!g.viimeisin[r.param] || g.viimeisin[r.param].aika < aika) g.viimeisin[r.param] = { aika, arvo: r.arvo };
    }
    const out = [];
    for (const g of ryhmat.values()) {
      const nimet = Object.keys(g.viimeisin), hsN = nimet.find(n => HS.test(n)), veN = nimet.find(n => VESI.test(n));
      if (!hsN && !veN) continue;
      const ajat = [hsN, veN].filter(Boolean).map(n => g.viimeisin[n].aika.getTime());
      out.push({ lat: g.lat, lon: g.lon, nimi: g.nimi, km: matka(lat, lon, g.lat, g.lon), suunta: suuntaSana(lat, lon, g.lat, g.lon),
        aika: new Date(Math.max(...ajat)), hs: hsN ? g.viimeisin[hsN].arvo : null, vesi: veN ? g.viimeisin[veN].arvo : null,
        muut: Object.fromEntries(nimet.map(n => [n, g.viimeisin[n].arvo])) });
    }
    return out.sort((a, b) => a.km - b.km).slice(0, max);
  }

  /** FMI timevaluepair (varalla, jos simple-kyselyä ei ole): [{lat, lon, aika, param, arvo, nimi}]. */
  function jasennaTvp(xml) {
    const out = [];
    // wfs:member sisältää target:member-elementtejä → jaetaan wfs:memberin alusta
    for (const m of String(xml).split(/<wfs:member\b/).slice(1).map(x => x.split('</wfs:member>')[0])) {
      const prop = (m.match(/observedProperty[^>]*href="[^"]*param=([^&"]+)/) || [])[1];
      const sarja = (m.match(/MeasurementTimeseries[^>]*gml:id="[^"]*-([A-Za-z0-9_]+)"/) || [])[1];
      const param = prop || sarja, pos = (tagi(m, 'pos') || '').split(/\s+/).map(Number);
      const nimi = (m.match(/<gml:name[^>]*codeSpace="[^"]*\/name"[^>]*>([^<]+)</) || [])[1] || null;
      if (!param || !(pos.length >= 2) || !isFinite(pos[0])) continue;
      for (const tvp of kaikki(m, 'MeasurementTVP')) {
        const aika = new Date(tagi(tvp, 'time')), arvo = parseFloat(tagi(tvp, 'value'));
        if (!isNaN(aika) && isFinite(arvo)) out.push({ lat: pos[0], lon: pos[1], aika, param, arvo, nimi });
      }
    }
    return out;
  }
  /** Mallin lähin meriruutu (arvo ei null) enintään maxKm päässä: { arvo, km } tai null. lahde = { lat[], lon[], kentta[t][i][j] }. */
  function lahinMeriarvo(lahde, kentta, t, lat, lon, maxKm = 5) {
    const k = lahde && lahde[kentta] && lahde[kentta][t];
    if (!k || !lahde.lat || !lahde.lon) return null;
    let paras = null;
    for (let i = 0; i < lahde.lat.length; i++) {
      if (Math.abs(lahde.lat[i] - lat) * 111 > maxKm) continue;
      for (let j = 0; j < lahde.lon.length; j++) {
        const v = k[i] && k[i][j];
        if (v === null || v === undefined || !isFinite(v)) continue;
        const d = matka(lat, lon, lahde.lat[i], lahde.lon[j]);
        if (d <= maxKm && (!paras || d < paras.km)) paras = { arvo: v, km: d };
      }
    }
    return paras;
  }

  // ------------------------------------------------------------ 6. turvalaiteviat
  function avain(o, re) { const k = Object.keys(o).find(x => re.test(x)); return k === undefined ? null : o[k]; }
  /** GeoJSON → [{ lat, lon, u (turvalaitenumero), nimi, vika, tila, aika, vayla }]. */
  function jasennaViat(geo) {
    const out = [];
    for (const f of (geo && geo.features) || []) {
      const g = f.geometry || {}, p = f.properties || {};
      if (g.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
      const [lon, lat] = g.coordinates;
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const u = avain(p, /^aton.?id$|^aton.?number$|turvalaitenumero/i);
      out.push({ lat, lon, u: u === null ? null : (isFinite(+u) ? +u : u),
        nimi: avain(p, /^aton.?name.?fi$|^aton.?name$|nimi/i), vika: avain(p, /^type.?fi$|^fault.?type|^type$/i),
        tila: avain(p, /^state|^status/i), aika: avain(p, /^entry.?timestamp|^created|^entry/i), vayla: avain(p, /^fairway.?name.?fi$|^fairway.?name/i),
        kiinnitetty: avain(p, /^fixed$|^fixed.?timestamp/i) });
    }
    return out;
  }
  /** Vika turvalaitteelle: numero samaksi tai alle 50 m. */
  function vikaMerkille(viat, m) {
    if (!viat || !m) return null;
    return viat.find(v => (m.u !== undefined && m.u !== null && v.u === m.u)) ||
      viat.find(v => matka(v.lat, v.lon, m.p[0], m.p[1]) < 0.05) || null;
  }
  /** Alueen rajojen sisällä olevat viat. */
  function alueenViat(viat, rajat) {
    if (!rajat) return [];
    return (viat || []).filter(v => v.lat >= rajat.lat_min && v.lat <= rajat.lat_max && v.lon >= rajat.lon_min && v.lon <= rajat.lon_max);
  }
  function vikaTeksti(v) {
    const pv = s => { const d = new Date(s); return isNaN(d) ? '' : `${d.getDate()}.${d.getMonth() + 1}.`; };
    const p = v.aika ? pv(v.aika) : '';
    return '⚠ Vika: ' + (v.vika || 'tuntematon') + (p ? `, ilmoitettu ${p}` : '') + (v.tila ? `, tila: ${String(v.tila).toLowerCase()}` : '');
  }

  // ------------------------------------------------------------ 4. salamat (v63)
  /** FMI simple -rivit → salamat [{ lat, lon, aika (ms), maa (true/false/null), virta (kA) }]; rivit ryhmitellään paikan ja ajan mukaan. */
  function salamat(rivit) {
    const g = new Map();
    for (const r of rivit || []) {
      const t = r.aika instanceof Date ? r.aika.getTime() : Date.parse(r.aika);
      if (!isFinite(r.lat) || !isFinite(r.lon) || !isFinite(t)) continue;
      const k = r.lat.toFixed(4) + ',' + r.lon.toFixed(4) + ',' + t;
      if (!g.has(k)) g.set(k, { lat: r.lat, lon: r.lon, aika: t, maa: null, virta: null });
      const x = g.get(k), p = String(r.param).toLowerCase();
      if (p === 'cloud_indicator' && isFinite(r.arvo)) x.maa = r.arvo === 0;
      if (p === 'peak_current' && isFinite(r.arvo)) x.virta = r.arvo;
    }
    return [...g.values()].sort((a, b) => a.aika - b.aika);
  }
  const SUUNTA_SSA = { P: 'pohjoisessa', KO: 'koillisessa', I: 'idässä', KA: 'kaakossa', E: 'etelässä', LO: 'lounaassa', L: 'lännessä', LU: 'luoteessa' };
  /** Tilanne pisteestä: lähin salama (km, suunta, min sitten) sade km ja ikkuna min sisällä, määrä, lähestyy [K: keskietäisyys
   *  viim. 15 min vs. 15–45 min sitten, molemmissa ≥ 3 salamaa, muutos ≥ 3 km]. null = ei salamoita. */
  function salamaTila(lista, lat, lon, nyt, sade = 60, ikkuna = 60) {
    const t0 = nyt instanceof Date ? nyt.getTime() : nyt;
    const x = (lista || []).map(s => Object.assign({ km: matka(lat, lon, s.lat, s.lon), min: (t0 - s.aika) / 60000 }, s))
      .filter(s => s.km <= sade && s.min <= ikkuna && s.min >= -5);
    if (!x.length) return null;
    const tuore = x.filter(s => s.min <= 30), viim = tuore.length ? tuore : x;
    const lahin = viim.reduce((a, b) => (b.km < a.km ? b : a));
    const ka = l => l.reduce((a, b) => a + b.km, 0) / l.length;
    const u = x.filter(s => s.min <= 15), v = x.filter(s => s.min > 15 && s.min <= 45);
    let suunta = null;
    if (u.length >= 3 && v.length >= 3) { const d = ka(u) - ka(v); suunta = d <= -3 ? 'lahestyy' : d >= 3 ? 'loittonee' : 'paikallaan'; }
    return { n: x.length, n30: tuore.length, maa: x.filter(s => s.maa).length,
      lahin: { km: lahin.km, suunta: suuntaSana(lat, lon, lahin.lat, lahin.lon), min: Math.max(0, lahin.min) },
      uusin: Math.max(0, Math.min(...x.map(s => s.min))), liike: suunta };
  }
  function salamaTeksti(st) {
    if (!st) return '';
    const l = st.lahin;
    return `⚡ Salamoita: lähin ${Math.round(l.km)} km ${l.suunta}, ${Math.round(l.min)} min sitten · ${st.n30} kpl / 30 min`
      + (st.liike === 'lahestyy' ? ' · lähestyy' : st.liike === 'loittonee' ? ' · loittonee' : '');
  }
  function salamaPuhe(st) {
    if (!st) return '';
    const l = st.lahin;
    return `Salamoita ${Math.round(l.km)} kilometriä ${SUUNTA_SSA[l.suunta] || ''}${st.liike === 'lahestyy' ? ', lähestyy' : st.liike === 'loittonee' ? ', loittonee' : ''}.`.replace(' ,', ',');
  }

  const Avoin = { tagi, jasennaCap, onMerella, pisteMonikulmiossa, koskeeAluetta, valitse, varoitusTeksti, syoteAika, VARI_FI,
    salamat, salamaTila, salamaTeksti, salamaPuhe, poijut, jasennaTvp, lahinMeriarvo, matka, suuntaSana, jasennaViat, vikaMerkille, alueenViat, vikaTeksti };
  if (typeof module !== 'undefined' && module.exports) module.exports = Avoin; else root.Avoin = Avoin;
})(typeof window !== 'undefined' ? window : this);
