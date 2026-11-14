/* Merilohitutka – ais.js (v23)
 * AIS-kohteet Fintrafficin Digitraffic-palvelusta (avoin data, CC BY 4.0). Hannu 14.11.2026: "Tehdään AIS."
 * Tarkistettu (digitraffic.fi 14.11.2026): palvelu jakaa vain A-luokan sijainti- ja tunnistesanomat; kaikki kalastusalukset
 * (alustyyppi 30) suodatetaan pois; B-luokka (huviveneet) suodatetaan tietosuojasyistä. Sijainnit GeoJSONina
 * (koordinaatit [lon, lat]), ominaisuudet mmsi, sog (solmua), cog, navStat, rot, posAcc, raim, heading, timestamp,
 * timestampExternal (ms). REST-rajapinnassa on viivettä ja välimuistia. Ei törmäyksenestoon: veneen oma AIS-VHF on se.
 * Puhtaat funktiot: testattavissa Nodessa. Haku ja ajastus ovat index.html:ssä.
 */
(function (root) {
  'use strict';
  const OSOITE = 'https://meri.digitraffic.fi/api/ais/v1';
  const KAYTTAJA = 'Merilohitutka/Lohirosvo';   // Digitraffic-User-otsake (Digitraffic suosittelee kaikkiin kutsuihin)
  const SOLMU = 1.852;   // km/h

  /** Alustyyppi (AIS shipType) -> { nimi, vari }. Digitrafficin taulukon mukaiset ryhmät. */
  function tyyppi(t) {
    t = Number(t);
    if (!isFinite(t) || t <= 0) return { nimi: 'tuntematon', vari: '#c9d3df' };
    if (t >= 60 && t < 70) return { nimi: 'matkustaja-alus', vari: '#ffffff' };
    if (t >= 70 && t < 80) return { nimi: 'rahtialus', vari: '#9fd0ff' };
    if (t >= 80 && t < 90) return { nimi: 'säiliöalus', vari: '#ffb36b' };
    if (t === 50) return { nimi: 'luotsivene', vari: '#ffe066' };
    if (t === 51) return { nimi: 'pelastusalus', vari: '#ff6b6b' };
    if (t === 52 || t === 31 || t === 32) return { nimi: 'hinaaja', vari: '#d0b3ff' };
    if (t === 55) return { nimi: 'viranomainen', vari: '#ffe066' };
    if (t === 35) return { nimi: 'sotilasalus', vari: '#c9d3df' };
    if (t === 33) return { nimi: 'ruoppaaja', vari: '#d0b3ff' };
    if (t === 36) return { nimi: 'purjealus', vari: '#c9d3df' };
    if (t === 37) return { nimi: 'huvialus', vari: '#c9d3df' };
    if (t >= 40 && t < 50) return { nimi: 'suurnopeusalus', vari: '#ffffff' };
    if (t >= 50 && t < 60) return { nimi: 'erikoisalus', vari: '#d0b3ff' };
    return { nimi: 'muu alus', vari: '#c9d3df' };
  }

  /** Sijaintikysely: piste ja säde (km); from = vanhin hyväksytty sijainti (ms), jos annettu. */
  function osoite(lat, lon, sadeKm, fromMs) {
    let u = `${OSOITE}/locations?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&radius=${Math.round(sadeKm)}`;
    if (isFinite(fromMs)) u += `&from=${Math.round(fromMs)}`;
    return u;
  }

  /** GeoJSON -> [{ mmsi, lat, lon, sog, cog, heading, navStat, t, ikaS }]. Puuttuvat arvot (AIS: sog 102,3, cog 360,
   *  heading 511) -> NaN. Yli maxIkaMin vanhat ja virheelliset sijainnit pois. */
  function jasenna(j, nytMs, maxIkaMin = 60) {
    const ulos = [];
    for (const f of (j && j.features) || []) {
      const c = f && f.geometry && f.geometry.coordinates, p = (f && f.properties) || {};
      if (!c || !isFinite(c[0]) || !isFinite(c[1]) || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) continue;
      const mmsi = Number(p.mmsi != null ? p.mmsi : f.mmsi);
      const t = Number(p.timestampExternal);
      if (!isFinite(mmsi) || !isFinite(t)) continue;
      const ikaS = (nytMs - t) / 1000;
      if (ikaS > maxIkaMin * 60) continue;
      const sog = Number(p.sog), cog = Number(p.cog), hd = Number(p.heading);
      ulos.push({ mmsi, lat: c[1], lon: c[0], sog: isFinite(sog) && sog < 102.2 ? sog : NaN, cog: isFinite(cog) && cog < 360 ? cog : NaN,
                  heading: isFinite(hd) && hd < 360 ? hd : NaN, navStat: Number(p.navStat), t, ikaS: Math.max(0, ikaS) });
    }
    return ulos;
  }

  /** Tunnistetiedot (yksi alus tai taulukko) -> { mmsi: { nimi, tyyppi, kohde } }. */
  function jasennaMeta(j) {
    const ulos = {};
    for (const v of Array.isArray(j) ? j : [j]) {
      if (!v || !isFinite(Number(v.mmsi))) continue;
      ulos[Number(v.mmsi)] = { nimi: String(v.name || '').trim(), tyyppi: Number(v.shipType), kohde: String(v.destination || '').trim() };
    }
    return ulos;
  }

  /** Paikallaan (ankkurissa tai kiinnitettynä tai alle 0,5 solmua). */
  function paikallaan(k) { return k.navStat === 1 || k.navStat === 5 || !(k.sog >= 0.5); }

  /** Lähin ohitus: oma { lat, lon, kmh, suunta } ja kohde { lat, lon, sog, cog }.
   *  Palauttaa { cpaM, tcpaMin, nytM } (tcpaMin < 0 = loittonee). Tasokoordinaatit pisteen ympärillä (lyhyet matkat). */
  function lahinOhitus(oma, k) {
    const kx = 111320 * Math.cos(oma.lat * Math.PI / 180), ky = 110574;
    const dx = (k.lon - oma.lon) * kx, dy = (k.lat - oma.lat) * ky;
    const nopeus = (kmh, s) => (isFinite(kmh) && isFinite(s) && kmh >= 0.5) ? [kmh / 3.6 * Math.sin(s * Math.PI / 180), kmh / 3.6 * Math.cos(s * Math.PI / 180)] : [0, 0];
    const [ox, oy] = nopeus(oma.kmh, oma.suunta), [vx0, vy0] = nopeus(k.sog * SOLMU, k.cog);
    const vx = vx0 - ox, vy = vy0 - oy, v2 = vx * vx + vy * vy, nytM = Math.hypot(dx, dy);
    if (v2 < 1e-6) return { cpaM: nytM, tcpaMin: Infinity, nytM };
    const t = -(dx * vx + dy * vy) / v2;
    return { cpaM: t > 0 ? Math.hypot(dx + vx * t, dy + vy * t) : nytM, tcpaMin: t / 60, nytM };
  }

  const AIS = { OSOITE, KAYTTAJA, SOLMU, tyyppi, osoite, jasenna, jasennaMeta, paikallaan, lahinOhitus };
  if (typeof module !== 'undefined' && module.exports) module.exports = AIS;
  else root.AIS = AIS;
})(typeof window !== 'undefined' ? window : this);
