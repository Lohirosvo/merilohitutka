/* Merilohitutka – fmi.js
 * Ilmatieteen laitoksen avoin data (WFS, simple-muoto): havainnot ja piste-ennuste.
 * Lähde: Ilmatieteen laitos, avoin data (CC BY 4.0).
 */
(function (root) {
  'use strict';

  const WFS = 'https://opendata.fmi.fi/wfs';
  const WFS_FIN = 'https://opendata.fmi.fi/wfs/fin'; // suomenkieliset paikannimet (asemahaku nimellä)

  // Asemanumerot (fmisid) näyttönimiksi.
  const ASEMANIMET = { '101661': 'Kokkola Tankar' };

  // Ennustekyselyt kokeillaan järjestyksessä. Ensimmäinen, josta saadaan myös puuska, valitaan.
  // Jos mistään ei saada puuskaa, käytetään ensimmäistä, josta saatiin keskituuli.
  const EDITED = 'fmi::forecast::edited::weather::scandinavia::point::simple';
  const MEPS = 'fmi::forecast::meps::surface::point::simple';
  const ENNUSTEKYSELYT = [
    { id: EDITED, puuska: 'HourlyMaximumGust', nimi: 'IL toimitettu ennuste' },
    { id: EDITED, puuska: 'WindGust', nimi: 'IL toimitettu ennuste' },
    { id: MEPS, puuska: 'WindGust', nimi: 'MEPS-malli' },
    { id: MEPS, puuska: 'HourlyMaximumGust', nimi: 'MEPS-malli' },
    { id: EDITED, puuska: null, nimi: 'IL toimitettu ennuste' }
  ];

  function isoAika(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

  function tagi(xml, nimi) {
    const m = xml.match(new RegExp('<(?:\\w+:)?' + nimi + '\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + nimi + '>'));
    return m ? m[1].trim() : null;
  }

  /** Jäsentää simple-muodon vastauksen: [{lat, lon, aika: Date, param, arvo}] */
  function jasennaSimple(xml) {
    if (/ExceptionReport/.test(xml)) {
      const viesti = tagi(xml, 'ExceptionText') || 'tuntematon virhe';
      throw new Error('FMI: ' + viesti.replace(/\s+/g, ' ').slice(0, 200));
    }
    const out = [];
    const re = /<(?:\w+:)?BsWfsElement\b[\s\S]*?<\/(?:\w+:)?BsWfsElement>/g;
    let m;
    while ((m = re.exec(xml))) {
      const el = m[0];
      const pos = (tagi(el, 'pos') || '').split(/\s+/).map(Number);
      const aika = tagi(el, 'Time');
      const param = tagi(el, 'ParameterName');
      const arvo = parseFloat(tagi(el, 'ParameterValue'));
      if (!aika || !param) continue;
      out.push({ lat: pos[0], lon: pos[1], aika: new Date(aika), param, arvo });
    }
    return out;
  }

  /** Muuntaa rivit aikasarjaksi: [{t, <param>: arvo, ...}] aikajärjestyksessä. */
  function aikasarjaksi(rivit) {
    const map = new Map();
    for (const r of rivit) {
      const k = r.aika.getTime();
      if (!map.has(k)) map.set(k, { t: r.aika });
      map.get(k)[r.param] = r.arvo;
    }
    return Array.from(map.values()).sort((a, b) => a.t - b.t);
  }

  async function hae(params, osoite) {
    const url = (osoite || WFS) + '?' + new URLSearchParams(Object.assign({
      service: 'WFS', version: '2.0.0', request: 'getFeature'
    }, params)).toString();
    const vastaus = await fetch(url);
    const teksti = await vastaus.text();
    if (!vastaus.ok && !/ExceptionReport/.test(teksti)) throw new Error('FMI HTTP ' + vastaus.status);
    return jasennaSimple(teksti);
  }

  /** Aseman viimeisimmät havainnot: {nimi, lat, lon, aika, ws, wg, wd, vis} */
  function viimeisimmat(nimi, rivit) {
    const sarja = aikasarjaksi(rivit);
    const tulos = { nimi, lat: NaN, lon: NaN, aika: null, ws: NaN, wg: NaN, wd: NaN, vis: NaN };
    if (rivit.length) { tulos.lat = rivit[0].lat; tulos.lon = rivit[0].lon; }
    for (let i = sarja.length - 1; i >= 0; i--) {
      const r = sarja[i];
      if (!tulos.aika && isFinite(r.ws_10min)) tulos.aika = r.t;
      if (!isFinite(tulos.ws) && isFinite(r.ws_10min)) tulos.ws = r.ws_10min;
      if (!isFinite(tulos.wg) && isFinite(r.wg_10min)) tulos.wg = r.wg_10min;
      if (!isFinite(tulos.wd) && isFinite(r.wd_10min)) tulos.wd = r.wd_10min;
      if (!isFinite(tulos.vis) && isFinite(r.vis)) tulos.vis = r.vis;
    }
    return tulos;
  }

  function etaisyysKm(a, b, c, d) {
    const r = x => x * Math.PI / 180;
    const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** "Nimi@lat,lon": haetaan alueen asemat ja valitaan pisteen lähin, jolla on tuulihavainto. */
  async function haeLahinAsema(nimi, lat, lon, nyt) {
    const d = 0.12, dl = 0.3; // noin ±13 km pohjois-etelä, ±15 km itä-länsi
    const rivit = await hae({
      storedquery_id: 'fmi::observations::weather::simple',
      bbox: [lon - dl, lat - d, lon + dl, lat + d].map(x => x.toFixed(3)).join(','),
      parameters: 'ws_10min,wg_10min,wd_10min,vis',
      starttime: isoAika(new Date(nyt.getTime() - 3 * 3600000))
    }, WFS_FIN);
    const asemat = new Map(); // sijainti -> rivit
    for (const r of rivit) {
      const k = r.lat.toFixed(4) + ',' + r.lon.toFixed(4);
      if (!asemat.has(k)) asemat.set(k, []);
      asemat.get(k).push(r);
    }
    let paras = null;
    for (const ryhma of asemat.values()) {
      if (!ryhma.some(r => r.param === 'ws_10min' && isFinite(r.arvo))) continue;
      const e = etaisyysKm(lat, lon, ryhma[0].lat, ryhma[0].lon);
      if (!paras || e < paras.e) paras = { e, ryhma };
    }
    if (!paras) throw new Error('alueelta ei löytynyt tuuliasemaa');
    const h = viimeisimmat(nimi, paras.ryhma);
    h.etaisyysArviosta = paras.e;
    return h;
  }

  /** asema: fmisid-numero ("101661"), aseman nimi, tai "Nimi@lat,lon" (lähin asema pisteestä). */
  async function haeHavainnot(asema, nyt) {
    asema = String(asema).trim();
    const piste = asema.match(/^(.*)@\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/);
    if (piste) return haeLahinAsema(piste[1].trim() || 'Asema', parseFloat(piste[2]), parseFloat(piste[3]), nyt);
    const onNumero = /^\d+$/.test(asema);
    const nimi = onNumero ? (ASEMANIMET[asema] ? ASEMANIMET[asema] + ' (' + asema + ')' : 'Asema ' + asema) : asema;
    const params = {
      storedquery_id: 'fmi::observations::weather::simple',
      parameters: 'ws_10min,wg_10min,wd_10min,vis',
      starttime: isoAika(new Date(nyt.getTime() - 3 * 3600000))
    };
    if (onNumero) params.fmisid = asema; else params.place = asema;
    let rivit;
    try {
      rivit = await hae(params, WFS_FIN);
    } catch (e) {
      if (onNumero) throw e;
      rivit = await hae(params, WFS); // varalla oletuskieli
    }
    if (!rivit.length) throw new Error('ei havaintoja');
    return viimeisimmat(nimi, rivit);
  }

  /** Piste-ennuste: {lahde, puuska: bool, rivit: [{t, ws, wg, wd}]} */
  let toimiva = 0; // viimeksi puuskan antanut kysely kokeillaan ensin

  async function haeEnnuste(lat, lon, nyt) {
    const virheet = [];
    let varalla = null; // ensimmäinen tulos, jossa keskituuli mutta ei puuskaa
    const jarjestys = ENNUSTEKYSELYT.slice(toimiva).concat(ENNUSTEKYSELYT.slice(0, toimiva));
    for (const k of jarjestys) {
      if (varalla && !k.puuska) continue; // keskituuli on jo, pelkkää keskituulta ei tarvitse hakea uudelleen
      try {
        const rivit = await hae({
          storedquery_id: k.id,
          latlon: lat.toFixed(4) + ',' + lon.toFixed(4),
          parameters: ['WindSpeedMS', 'WindDirection'].concat(k.puuska ? [k.puuska] : []).join(','),
          timestep: '60',
          starttime: isoAika(new Date(nyt.getTime() - 3600000)),
          endtime: isoAika(new Date(nyt.getTime() + 48 * 3600000))
        });
        const sarja = aikasarjaksi(rivit).map(r => ({
          t: r.t, ws: r.WindSpeedMS, wg: k.puuska ? r[k.puuska] : NaN, wd: r.WindDirection
        })).filter(r => isFinite(r.ws));
        if (!sarja.length) { virheet.push(k.nimi + ': tyhjä vastaus'); continue; }
        if (sarja.some(r => isFinite(r.wg))) {
          toimiva = ENNUSTEKYSELYT.indexOf(k);
          return { lahde: k.nimi + ' (puuska: ' + k.puuska + ')', puuska: true, rivit: sarja };
        }
        if (!varalla) varalla = { lahde: k.nimi, puuska: false, rivit: sarja };
      } catch (e) {
        virheet.push(k.nimi + (k.puuska ? '/' + k.puuska : '') + ': ' + e.message);
      }
    }
    if (varalla) return varalla;
    throw new Error('Ennustetta ei saatu. ' + virheet.join(' | '));
  }

  const FMI = { haeLahinAsema, jasennaSimple, aikasarjaksi, viimeisimmat, haeHavainnot, haeEnnuste, isoAika };
  if (typeof module !== 'undefined' && module.exports) module.exports = FMI;
  else root.FMI = FMI;
})(typeof window !== 'undefined' ? window : this);
