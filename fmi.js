/* Merilohitutka – fmi.js
 * Ilmatieteen laitoksen avoin data (WFS, simple-muoto): havainnot ja piste-ennuste.
 * Lähde: Ilmatieteen laitos, avoin data (CC BY 4.0).
 */
(function (root) {
  'use strict';

  const WFS = 'https://opendata.fmi.fi/wfs';

  // Ennustekyselyt kokeillaan järjestyksessä; ensimmäinen toimiva jää käyttöön.
  const ENNUSTEKYSELYT = [
    { id: 'fmi::forecast::edited::weather::scandinavia::point::simple', param: 'WindSpeedMS,WindGust,WindDirection', nimi: 'IL toimitettu ennuste' },
    { id: 'fmi::forecast::meps::surface::point::simple', param: 'WindSpeedMS,WindGust,WindDirection', nimi: 'MEPS-malli' },
    { id: 'fmi::forecast::edited::weather::scandinavia::point::simple', param: 'WindSpeedMS,WindDirection', nimi: 'IL toimitettu ennuste (ilman puuskaa)' }
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

  async function hae(params) {
    const url = WFS + '?' + new URLSearchParams(Object.assign({
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

  async function haeHavainnot(asemaNimi, nyt) {
    const rivit = await hae({
      storedquery_id: 'fmi::observations::weather::simple',
      place: asemaNimi,
      parameters: 'ws_10min,wg_10min,wd_10min,vis',
      starttime: isoAika(new Date(nyt.getTime() - 3 * 3600000))
    });
    if (!rivit.length) throw new Error(asemaNimi + ': ei havaintoja');
    return viimeisimmat(asemaNimi, rivit);
  }

  /** Piste-ennuste: {lahde, puuska: bool, rivit: [{t, ws, wg, wd}]} */
  let toimiva = 0; // viimeksi toiminut kysely kokeillaan ensin

  async function haeEnnuste(lat, lon, nyt) {
    const virheet = [];
    const jarjestys = ENNUSTEKYSELYT.slice(toimiva).concat(ENNUSTEKYSELYT.slice(0, toimiva));
    for (const k of jarjestys) {
      try {
        const rivit = await hae({
          storedquery_id: k.id,
          latlon: lat.toFixed(4) + ',' + lon.toFixed(4),
          parameters: k.param,
          timestep: '60',
          starttime: isoAika(new Date(nyt.getTime() - 3600000)),
          endtime: isoAika(new Date(nyt.getTime() + 24 * 3600000))
        });
        const sarja = aikasarjaksi(rivit).map(r => ({
          t: r.t, ws: r.WindSpeedMS, wg: r.WindGust, wd: r.WindDirection
        })).filter(r => isFinite(r.ws));
        if (sarja.length) {
          toimiva = ENNUSTEKYSELYT.indexOf(k);
          return { lahde: k.nimi, puuska: sarja.some(r => isFinite(r.wg)), rivit: sarja };
        }
        virheet.push(k.nimi + ': tyhjä vastaus');
      } catch (e) {
        virheet.push(k.nimi + ': ' + e.message);
      }
    }
    throw new Error('Ennustetta ei saatu. ' + virheet.join(' | '));
  }

  const FMI = { jasennaSimple, aikasarjaksi, viimeisimmat, haeHavainnot, haeEnnuste, isoAika };
  if (typeof module !== 'undefined' && module.exports) module.exports = FMI;
  else root.FMI = FMI;
})(typeof window !== 'undefined' ? window : this);
