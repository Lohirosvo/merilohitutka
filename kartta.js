/* Merilohitutka – kartta.js
 * Kevyt oma karttanäkymä (ei ulkoisia kirjastoja): OSM-taustakartta valinnaisena,
 * Copernicus-datasta lämpökäyrät, lohikerros (lämpövälin syvyys), satelliittilämpö, pintavirtanuolet
 * ja aallonkorkeus. Traficomin merikartan syvyyskäyrät (v8), Väyläviraston väylät ja IL:n tuulinuolet (v9).
 * Syvyys ja väylät: ei navigointikäyttöön.
 * Puhtaat laskentafunktiot (käyrät, projektio, lähin arvo) testattavissa Nodessa.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ laskenta
  const TILE = 256;
  function lonX(lon, z) { return (lon + 180) / 360 * TILE * Math.pow(2, z); }
  function latY(lat, z) {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TILE * Math.pow(2, z);
  }
  function xLon(x, z) { return x / (TILE * Math.pow(2, z)) * 360 - 180; }
  function yLat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / (TILE * Math.pow(2, z));
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  /** Murtoindeksi -> koordinaatti (lineaarinen interpolointi akselilla). */
  function akseliArvo(akseli, f) {
    const i = Math.max(0, Math.min(akseli.length - 2, Math.floor(f)));
    return akseli[i] + (f - i) * (akseli[i + 1] - akseli[i]);
  }

  /**
   * Marching squares. z[i][j]: i = leveysindeksi, j = pituusindeksi. Ruudut, joissa on puuttuva arvo
   * (maa), ohitetaan. Palauttaa janat [[lat1, lon1, lat2, lon2], ...].
   */
  function kayra(z, lat, lon, taso) {
    const janat = [];
    const ni = lat.length, nj = lon.length;
    const ok = v => v !== null && v !== undefined && isFinite(v);
    for (let i = 0; i < ni - 1; i++) {
      for (let j = 0; j < nj - 1; j++) {
        const a = z[i][j], b = z[i][j + 1], c = z[i + 1][j + 1], d = z[i + 1][j];
        if (!ok(a) || !ok(b) || !ok(c) || !ok(d)) continue;
        const k = (a >= taso ? 1 : 0) | (b >= taso ? 2 : 0) | (c >= taso ? 4 : 0) | (d >= taso ? 8 : 0);
        if (k === 0 || k === 15) continue;
        const ala = () => [i, j + (taso - a) / (b - a)];
        const oik = () => [i + (taso - b) / (c - b), j + 1];
        const yla = () => [i + 1, j + (taso - d) / (c - d)];
        const vas = () => [i + (taso - a) / (d - a), j];
        let p = [];
        switch (k) {
          case 1: case 14: p = [[vas(), ala()]]; break;
          case 2: case 13: p = [[ala(), oik()]]; break;
          case 3: case 12: p = [[vas(), oik()]]; break;
          case 4: case 11: p = [[oik(), yla()]]; break;
          case 6: case 9: p = [[ala(), yla()]]; break;
          case 7: case 8: p = [[vas(), yla()]]; break;
          case 5: { const keski = (a + b + c + d) / 4 >= taso;
            p = keski ? [[ala(), oik()], [vas(), yla()]] : [[vas(), ala()], [oik(), yla()]]; break; }
          case 10: { const keski = (a + b + c + d) / 4 >= taso;
            p = keski ? [[vas(), ala()], [oik(), yla()]] : [[ala(), oik()], [vas(), yla()]]; break; }
        }
        for (const [[fi1, fj1], [fi2, fj2]] of p) {
          janat.push([akseliArvo(lat, fi1), akseliArvo(lon, fj1), akseliArvo(lat, fi2), akseliArvo(lon, fj2)]);
        }
      }
    }
    return janat;
  }

  /** Kenttien arvoväli (puuttuvat ohitetaan). */
  function arvovali(z) {
    let min = Infinity, max = -Infinity;
    for (const rivi of z) for (const v of rivi) if (v !== null && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    return [min, max];
  }

  /** Käyrätasot askeleella (esim. 0,2 °C) arvovälin sisällä. Pyöristys estää liukulukuvirheet. */
  function tasot(min, max, askel) {
    if (!isFinite(min) || !isFinite(max) || !(askel > 0)) return [];
    const out = [];
    for (let v = Math.ceil(min / askel) * askel; v <= max + 1e-9; v += askel) out.push(Math.round(v * 1000) / 1000);
    return out.length > 200 ? [] : out;
  }

  /** Lähimmän ruudun indeksi. */
  function lahinIndeksi(akseli, arvo) {
    let paras = 0;
    for (let i = 1; i < akseli.length; i++) if (Math.abs(akseli[i] - arvo) < Math.abs(akseli[paras] - arvo)) paras = i;
    return paras;
  }
  function lahinArvo(lahde, kentta, t, lat, lon) {
    if (!lahde || !lahde[kentta] || !lahde[kentta][t]) return NaN;
    const i = lahinIndeksi(lahde.lat, lat), j = lahinIndeksi(lahde.lon, lon);
    if (Math.abs(lahde.lat[i] - lat) > 0.05 || Math.abs(lahde.lon[j] - lon) > 0.1) return NaN; // alueen ulkopuolella
    const v = lahde[kentta][t][i][j];
    return v === null ? NaN : v;
  }
  /** Lähin aikaindeksi. */
  function lahinAika(ajat, ms) {
    let paras = 0;
    for (let i = 1; i < ajat.length; i++) if (Math.abs(Date.parse(ajat[i]) - ms) < Math.abs(Date.parse(ajat[paras]) - ms)) paras = i;
    return paras;
  }
  /** Virran suunta (mihin vesi virtaa, ° pohjoisesta myötäpäivään) ja nopeus m/s. */
  function virta(u, v) {
    return { nopeus: Math.hypot(u, v), suunta: (Math.atan2(u, v) * 180 / Math.PI + 360) % 360 };
  }

  /**
   * Lohikerros: millä syvyydellä lämpö on välillä tMin–tMax.
   * arvot[k] = lämpö tasolla k (null = pohjan alla tai maa), syv[k] = tason keskisyvyys (m).
   * Lämpö oletetaan pinnasta ylimpään tasoon vakioksi ja tasojen välillä lineaariseksi.
   * Palauttaa null (maa) tai { loytyi, yla, ala, paksuus, pohja, taysi, pohjaan }:
   *   yla/ala = ylin ja alin syvyys, jossa lämpö on välillä; paksuus = välillä olevien osien summa
   *   pohja = syvin kelvollinen taso; taysi = kaikki haetut tasot kelvollisia (meri syvempi kuin profiili)
   *   pohjaan = kerros ulottuu syvimpään kelvolliseen tasoon asti.
   */
  function kerros(arvot, syv, tMin, tMax) {
    const p = [];
    for (let k = 0; k < syv.length; k++) {
      const v = arvot[k];
      if (v === null || v === undefined || !isFinite(v)) break;
      p.push([syv[k], v]);
    }
    if (!p.length) return null;
    const pts = p[0][0] > 0 ? [[0, p[0][1]]].concat(p) : p;
    const sis = v => v >= tMin - 1e-9 && v <= tMax + 1e-9;
    let yla = null, ala = null, paksuus = 0;
    for (let n = 0; n < pts.length - 1; n++) {
      const [d1, t1] = pts[n], [d2, t2] = pts[n + 1];
      let lo, hi;
      if (Math.abs(t2 - t1) < 1e-12) { if (!sis(t1)) continue; lo = 0; hi = 1; }
      else {
        let s1 = (tMin - t1) / (t2 - t1), s2 = (tMax - t1) / (t2 - t1);
        if (s1 > s2) [s1, s2] = [s2, s1];
        lo = Math.max(0, s1); hi = Math.min(1, s2);
      }
      const a = d1 + lo * (d2 - d1), b = d1 + hi * (d2 - d1);
      if (!(b - a > 1e-9)) continue;
      if (yla === null || a < yla) yla = a;
      if (ala === null || b > ala) ala = b;
      paksuus += b - a;
    }
    const pohja = p[p.length - 1][0];
    return { loytyi: yla !== null, yla, ala, paksuus, pohja, taysi: p.length === syv.length,
             pohjaan: ala !== null && ala >= pohja - 1e-6 };
  }
  /** Kerroksen luokka kartan väriä varten: 'optimi' (alkaa 0–3 m), 'keski' (3–6 m), 'syva' (yli 6 m), 'ei'. */
  function lohiLuokka(k) {
    if (!k) return null;
    if (!k.loytyi) return 'ei';
    return k.yla <= 3 + 1e-9 ? 'optimi' : (k.yla <= 6 + 1e-9 ? 'keski' : 'syva');
  }
  /**
   * syvyys.json (delta-koodattu, ks. hae_syvyys.py) -> { luotu, lahde, huom, tasot: [{ syvyys, viivat: [v] }] }
   * v = { ll: Float64Array [lat, lon, …], m: Float64Array [x, y, …] (Mercator z = 0), la0, la1, lo0, lo1 }
   */
  function puraSyvyys(j) {
    if (!j || !j.kayrat) return null;
    const [olat, olon] = j.origo, k = j.kerroin || 100000, tasot = [];
    for (const avain of Object.keys(j.kayrat)) {
      const viivat = [];
      for (const koodi of j.kayrat[avain]) {
        const n = koodi.length >> 1, ll = new Float64Array(n * 2), m = new Float64Array(n * 2);
        let x = 0, y = 0, la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
        for (let i = 0; i < n; i++) {
          x += koodi[2 * i]; y += koodi[2 * i + 1];
          const lat = olat + y / k, lon = olon + x / k;
          ll[2 * i] = lat; ll[2 * i + 1] = lon; m[2 * i] = lonX(lon, 0); m[2 * i + 1] = latY(lat, 0);
          if (lat < la0) la0 = lat; if (lat > la1) la1 = lat; if (lon < lo0) lo0 = lon; if (lon > lo1) lo1 = lon;
        }
        if (n >= 2) viivat.push({ ll, m, la0, la1, lo0, lo1 });
      }
      tasot.push({ syvyys: parseFloat(avain), viivat });
    }
    tasot.sort((a, b) => a.syvyys - b.syvyys);
    return { luotu: j.luotu, lahde: j.lahde, huom: j.huom, tasot };
  }
  /** Yksi delta-koodattu viiva -> { ll, m, la0, la1, lo0, lo1 } (ks. puraSyvyys). */
  function puraViiva(koodi, olat, olon, k) {
    const n = koodi.length >> 1, ll = new Float64Array(n * 2), m = new Float64Array(n * 2);
    let x = 0, y = 0, la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
    for (let i = 0; i < n; i++) {
      x += koodi[2 * i]; y += koodi[2 * i + 1];
      const lat = olat + y / k, lon = olon + x / k;
      ll[2 * i] = lat; ll[2 * i + 1] = lon; m[2 * i] = lonX(lon, 0); m[2 * i + 1] = latY(lat, 0);
      if (lat < la0) la0 = lat; if (lat > la1) la1 = lat; if (lon < lo0) lo0 = lon; if (lon > lo1) lo1 = lon;
    }
    return { ll, m, la0, la1, lo0, lo1 };
  }
  /** vaylat.json -> { luotu, linjat: [v + { syvyys, haraus }], alueet: [sama] }
   *  syvyys = mitoitussyväys, haraus = haraussyvyys (Väyläviraston kentät). Vanha muoto: linja pelkkä taulukko. */
  function puraVaylat(j) {
    if (!j || (!j.linjat && !j.alueet)) return null;
    const [olat, olon] = j.origo, k = j.kerroin || 100000;
    const pura = a => {
      const koodi = Array.isArray(a) ? a : a.k;
      if (!koodi || koodi.length < 4) return null;
      return Object.assign(puraViiva(koodi, olat, olon, k), {
        syvyys: Array.isArray(a) || a.s === undefined ? null : a.s, haraus: Array.isArray(a) || a.h === undefined ? null : a.h });
    };
    return { luotu: j.luotu, lahde: j.lahde, linjat: (j.linjat || []).map(pura).filter(Boolean), alueet: (j.alueet || []).map(pura).filter(Boolean) };
  }
  /** Lähin viiva listasta: { v, m } tai null. */
  function lahinViivoista(viivat, lat, lon, rajaM) {
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110574, dLa = rajaM / ky, dLo = rajaM / kx;
    let paras = null;
    for (const v of viivat) {
      if (v.la1 < lat - dLa || v.la0 > lat + dLa || v.lo1 < lon - dLo || v.lo0 > lon + dLo) continue;
      const p = v.ll;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = (p[i + 1] - lon) * kx, ay = (p[i] - lat) * ky, bx = (p[i + 3] - lon) * kx, by = (p[i + 2] - lat) * ky;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d <= rajaM && (!paras || d < paras.m)) paras = { v, m: d };
      }
    }
    return paras;
  }
  /** Lähin väylä: { m, syvyys } – alueen kulkusyvyys, jos lähin on väyläalueen reuna tai linja on alueen sisällä. */
  function lahinVayla(V, lat, lon, rajaM) {
    if (!V) return null;
    const a = lahinViivoista(V.alueet, lat, lon, rajaM || 1500), l = lahinViivoista(V.linjat, lat, lon, rajaM || 1500);
    if (!a && !l) return null;
    const paras = !a ? l : !l ? a : (a.m <= l.m ? a : l);
    let syv = paras.v.syvyys === undefined ? null : paras.v.syvyys, haraus = paras.v.haraus === undefined ? null : paras.v.haraus;
    if (syv === null && a && a.m < 400) { syv = a.v.syvyys; haraus = a.v.haraus; }   // linja alueen sisällä: alueen syvyydet
    return { m: paras.m, syvyys: syv, haraus };
  }

  /** Lähin syvyyskäyrä pisteestä (enintään rajaM metriä): { syvyys, m } tai null. vainSyvyys rajaa yhteen syvyyteen. */
  function lahinKayra(S, lat, lon, vainSyvyys, rajaM) {
    if (!S) return null;
    rajaM = rajaM || 3000;
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110574;
    const dLa = rajaM / ky, dLo = rajaM / kx;
    let paras = null;
    for (const taso of S.tasot) {
      if (vainSyvyys !== undefined && vainSyvyys !== null && taso.syvyys !== vainSyvyys) continue;
      for (const v of taso.viivat) {
        if (v.la1 < lat - dLa || v.la0 > lat + dLa || v.lo1 < lon - dLo || v.lo0 > lon + dLo) continue;
        const p = v.ll;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const ax = (p[i + 1] - lon) * kx, ay = (p[i] - lat) * ky, bx = (p[i + 3] - lon) * kx, by = (p[i + 2] - lat) * ky;
          const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
          const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
          const d = Math.hypot(ax + t * dx, ay + t * dy);
          if (d <= rajaM && (!paras || d < paras.m)) paras = { syvyys: taso.syvyys, m: d };
        }
      }
    }
    return paras;
  }

  /** Lähimmän ruudun lämpöprofiili ajanhetkellä t: { syvyydet, arvot, i, j } tai null. */
  function profiiliPisteessa(phy, t, lat, lon) {
    if (!phy || !phy.profiili || !phy.profiili[t] || !phy.syvyydet) return null;
    const i = lahinIndeksi(phy.lat, lat), j = lahinIndeksi(phy.lon, lon);
    if (Math.abs(phy.lat[i] - lat) > 0.05 || Math.abs(phy.lon[j] - lon) > 0.1) return null;
    return { syvyydet: phy.syvyydet, arvot: phy.profiili[t].map(taso => taso[i][j]), i, j };
  }

  // ------------------------------------------------------------ värit
  function lampoVari(v, min, max) {
    const f = max > min ? (v - min) / (max - min) : 0.5;
    const h = 240 - 240 * Math.max(0, Math.min(1, f)); // sininen -> punainen
    return `hsl(${h},90%,${55 + 10 * Math.sin(f * Math.PI)}%)`;
  }
  /** Tuulen väri: Hannun paluuraja 10 m/s punaisena. */
  /** Omat havainnot (havainnot.js ja puhelimeen tallennetut saaliit): värit lajin mukaan. */
  const HAVAINTOVARIT = { lammin: '255,122,69', kylma: '77,163,255', muu: '190,150,255', saalis: '255,77,109' };
  function havaintoVari(laji) { return HAVAINTOVARIT[laji] || HAVAINTOVARIT.muu; }
  const KM_LAT = 110.574;
  function kmLon(lat) { return 111.32 * Math.cos(lat * Math.PI / 180); }
  /** Etäisyys (km) pisteestä murtoviivaan [[lat, lon], ...] ja lähimmän kohdan leveys. */
  function etaisyysViivaan(pisteet, lat, lon) {
    const kx = kmLon(lat);
    let paras = { km: Infinity, lat: null };
    for (let i = 0; i + 1 < pisteet.length; i++) {
      const [a0, b0] = pisteet[i], [a1, b1] = pisteet[i + 1];
      const ax = (b0 - lon) * kx, ay = (a0 - lat) * KM_LAT, bx = (b1 - lon) * kx, by = (a1 - lat) * KM_LAT;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const km = Math.hypot(ax + t * dx, ay + t * dy);
      if (km < paras.km) paras = { km, lat: a0 + t * (a1 - a0) };
    }
    return paras;
  }
  /** Viivan vahvistusryhmä leveyden mukaan (esim. 62,25–62,42 = 5 havaintoa) tai null. */
  function vahvistusRyhma(h, lat) {
    for (const r of h.vahvistukset || []) if (lat >= r.lat[0] && lat <= r.lat[1]) return r;
    return null;
  }
  /** Ellipsi rajausruudun sisällä: (x/a)^2 + (y/b)^2, < 1 = sisällä. */
  function ellipsiArvo(lat, lon, la, lo) {
    const a = (lo[1] - lo[0]) / 2, b = (la[1] - la[0]) / 2;
    return Math.pow((lon - (lo[0] + lo[1]) / 2) / a, 2) + Math.pow((lat - (la[0] + la[1]) / 2) / b, 2);
  }
  /** Havainnot pisteessä: [{ h, km, ryhma, reunalla }]. Viiva: leveys_km sisällä; alue: ellipsi (tai reuna);
   *  saalis: 0,8 km; piste: max(sade_km, 1,5 km); kaista: lat- ja lon-väli. */
  function havaintoTiedot(H, lat, lon) {
    const tulos = [];
    for (const h of H || []) {
      if (h.tyyppi === 'viiva') {
        const e = etaisyysViivaan(h.pisteet, lat, lon);
        if (e.km <= (h.leveys_km || 1)) tulos.push({ h, km: e.km, ryhma: vahvistusRyhma(h, e.lat) });
      } else if (h.tyyppi === 'alue') {
        if (ellipsiArvo(lat, lon, h.lat, h.lon) <= 1) tulos.push({ h });
        else if (h.reuna && ellipsiArvo(lat, lon, h.reuna.lat, h.reuna.lon) <= 1) tulos.push({ h, reunalla: true });
      } else if (h.tyyppi === 'kaista') {
        if (lat >= h.lat[0] && lat <= h.lat[1] && lon >= h.lon[0] && lon <= h.lon[1]) tulos.push({ h });
      } else if (isFinite(h.lat) && isFinite(h.lon)) {
        const km = Math.hypot((h.lon - lon) * kmLon(lat), (h.lat - lat) * KM_LAT);
        if (km <= (h.tyyppi === 'saalis' ? 0.8 : Math.max(h.sade_km || 0, 1.5))) tulos.push({ h, km });
      }
    }
    return tulos;
  }
  function havainnotPisteessa(H, lat, lon) { return havaintoTiedot(H, lat, lon).map(t => t.h); }
  /** Saalispisteiden teksti (lat,lon tieto (varmuus: lisä)) -> [{ tyyppi: 'saalis', ... }]. Muut rivit ohitetaan. */
  function jasennaSaaliit(teksti) {
    const tulos = [];
    for (const rivi of String(teksti || '').split(/\r?\n/)) {
      const m = rivi.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s+(.+?)\s*$/);
      if (!m) continue;
      const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
      if (!(lat > 50 && lat < 70 && lon > 5 && lon < 35)) continue;
      let tieto = m[3], varmuus = null, lisa = null;
      const v = tieto.match(/\(\s*([A-ZÅÄÖ])\s*(?::\s*([^)]*))?\)\s*$/);
      if (v) { varmuus = v[1]; lisa = v[2] ? v[2].trim() : null; tieto = tieto.slice(0, v.index).trim(); }
      const lyhyt = tieto.length > 26 ? tieto.slice(0, 25).replace(/[\s,]+\S*$/, '') + '…' : tieto;
      tulos.push({ tyyppi: 'saalis', laji: 'saalis', lat, lon, nimi: lyhyt, teksti: tieto, varmuus, lisa });
    }
    return tulos;
  }
  function tuuliVari(ws) { return ws >= 10 ? '#ff5c5c' : ws >= 8 ? '#ffa94d' : ws >= 5 ? '#ffe066' : '#e8f4ff'; }
  /** Aaltoraja (v17, Hannu 13.11.): merkitsevä aallonkorkeus -> 0 = alle rajan 1, 1 = raja 1 (oletus 0,35 m), 2 = raja 2 (0,5 m). */
  function aaltoLuokka(hs, rajat) {
    if (hs === null || hs === undefined || !isFinite(hs)) return 0;
    return hs >= rajat[1] ? 2 : hs >= rajat[0] ? 1 : 0;
  }
  /** Matalikot syvyyskäyristä (v21, Hannu 13.11.: "10 m matalikko–20 m tai poikkeaa ympäristöstä merkittävästi").
   *  Suljettu käyrä (rengas), jonka sisällä vesi on matalampaa, on mäki. Huippu = sisin mäkirengas: matalin kohta on
   *  sen syvyyden ja seuraavan matalamman käyrätason välissä. Mäki vai kuoppa: renkaan sisällä olevista renkaista,
   *  muuten ympäröivästä renkaasta, muuten lähimmästä avoimesta käyrästä (enintään 3 km). Saman syvyyden pätkät
   *  yhdistetään päistään (käyrä voi olla pätkitty). Luokat: 'vali' = huippurengas min–max m (oletus 10–20);
   *  'nousu' = matalin kohta vähintään 3 m:ssä (ei saaria eikä pintaan nousevia karikoita) ja uloin mäkirengas
   *  vähintään nousuM syvemmällä kuin huippurengas (oletus 5 m). Reunalla katkenneet käyrät eivät ole renkaita. */
  function ketjuta(viivat) {
    const avain = (a, i) => Math.round(a[i] * 1e5) + ',' + Math.round(a[i + 1] * 1e5);
    const suljettu = a => a.length >= 8 && avain(a, 0) === avain(a, a.length - 2);
    const valmiit = [], auki = [];
    for (const v of viivat) (suljettu(v) ? valmiit : auki).push(Array.from(v));
    const paat = new Map(), lisaa = (k, i) => { if (!paat.has(k)) paat.set(k, []); paat.get(k).push(i); };
    auki.forEach((a, i) => { lisaa(avain(a, 0), i); lisaa(avain(a, a.length - 2), i); });
    const kaytetty = new Array(auki.length).fill(false);
    const kaanna = a => { const b = []; for (let i = a.length - 2; i >= 0; i -= 2) b.push(a[i], a[i + 1]); return b; };
    const seuraava = k => (paat.get(k) || []).find(j => !kaytetty[j]);
    for (let i = 0; i < auki.length; i++) {
      if (kaytetty[i]) continue;
      kaytetty[i] = true; let ketju = auki[i];
      for (let kierros = 0; kierros < 2; kierros++) {   // jatketaan loppupäästä, sitten käännettynä alkupäästä
        for (;;) {
          if (suljettu(ketju)) break;
          const k = avain(ketju, ketju.length - 2), j = seuraava(k);
          if (j === undefined) break;
          kaytetty[j] = true;
          const b = avain(auki[j], 0) === k ? auki[j] : kaanna(auki[j]);
          ketju = ketju.concat(b.slice(2));
        }
        ketju = kaanna(ketju);
      }
      valmiit.push(ketju);
    }
    return valmiit.map(a => ({ ll: a, suljettu: suljettu(a) }));
  }
  function rajaus(ll) {
    let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
    for (let i = 0; i < ll.length; i += 2) { const a = ll[i], o = ll[i + 1]; if (a < la0) la0 = a; if (a > la1) la1 = a; if (o < lo0) lo0 = o; if (o > lo1) lo1 = o; }
    return { la0, la1, lo0, lo1 };
  }
  function renkaanSisalla(ll, lat, lon) {
    let sis = false;
    for (let i = 0, j = ll.length - 2; i < ll.length; j = i, i += 2) {
      const ai = ll[i], oi = ll[i + 1], aj = ll[j], oj = ll[j + 1];
      if ((ai > lat) !== (aj > lat) && lon < (oj - oi) * (lat - ai) / (aj - ai) + oi) sis = !sis;
    }
    return sis;
  }
  function matalikot(S, o = {}) {
    const min = isFinite(o.min) ? o.min : 10, max = isFinite(o.max) ? o.max : 20, nousuM = isFinite(o.nousuM) ? o.nousuM : 5;
    const tulos = { matalikot: [], renkaita: 0, maki: 0, kuoppa: 0, epaselva: 0 };
    if (!S || !S.tasot) return tulos;
    const tasot = S.tasot.map(t => t.syvyys).filter(isFinite).sort((a, b) => a - b);
    const R = [], A = [];
    for (const t of S.tasot) for (const k of ketjuta(t.viivat.map(v => v.ll))) {
      const x = Object.assign({ d: t.syvyys, ll: k.ll }, rajaus(k.ll));
      if (k.suljettu) { x.ala = (x.la1 - x.la0) * (x.lo1 - x.lo0); x.lapset = []; x.ylempi = null; R.push(x); } else A.push(x);
    }
    tulos.renkaita = R.length;
    R.sort((a, b) => a.ala - b.ala);
    for (let i = 0; i < R.length; i++) {   // ylempi = pienin rengas, jonka sisällä tämä on (käyrät eivät leikkaa)
      const a = R[i];
      for (let j = i + 1; j < R.length; j++) {
        const b = R[j];
        if (b.la0 <= a.la0 && b.la1 >= a.la1 && b.lo0 <= a.lo0 && b.lo1 >= a.lo1 && renkaanSisalla(b.ll, a.ll[0], a.ll[1])) { a.ylempi = b; b.lapset.push(a); break; }
      }
    }
    const lahinAvoin = a => {   // lähin eri syvyyden avoin käyrä enintään 3 km:n päässä (pisteet harvennettuina)
      const v = 0.03, kx = kmLon(a.la0), ehd = [];
      for (const b of A) {   // rajausruutujen etäisyys = alaraja; lähimmät ensin, kauemmat ohitetaan
        if (b.d === a.d || b.la1 < a.la0 - v || b.la0 > a.la1 + v || b.lo1 < a.lo0 - 2 * v || b.lo0 > a.lo1 + 2 * v) continue;
        const dy = Math.max(0, b.la0 - a.la1, a.la0 - b.la1) * KM_LAT, dx = Math.max(0, b.lo0 - a.lo1, a.lo0 - b.lo1) * kx;
        ehd.push([Math.hypot(dx, dy), b]);
      }
      ehd.sort((x, y) => x[0] - y[0]);
      let paras = null, pm = 3;
      const ra = Math.max(1, Math.floor(a.ll.length / 2 / 16)) * 2;
      for (const [alaraja, b] of ehd) {
        if (alaraja >= pm) break;
        const rb = Math.max(1, Math.floor(b.ll.length / 2 / 150)) * 2;
        for (let i = 0; i < a.ll.length; i += ra) for (let j = 0; j < b.ll.length; j += rb) {
          const dy = (a.ll[i] - b.ll[j]) * KM_LAT, dx = (a.ll[i + 1] - b.ll[j + 1]) * kx, m = dx * dx + dy * dy;
          if (m < pm * pm) { pm = Math.sqrt(m); paras = b; }
        }
      }
      return paras;
    };
    for (const a of R) {
      const mat = a.lapset.some(c => c.d < a.d), syv = a.lapset.some(c => c.d > a.d);
      if (mat || syv) a.tyyppi = mat && !syv ? 'maki' : syv && !mat ? 'kuoppa' : null;
      else if (a.ylempi && a.ylempi.d !== a.d) a.tyyppi = a.ylempi.d > a.d ? 'maki' : 'kuoppa';
      else { const b = lahinAvoin(a); a.tyyppi = b ? (b.d > a.d ? 'maki' : 'kuoppa') : null; }
      if (a.tyyppi === 'maki') tulos.maki++; else if (a.tyyppi === 'kuoppa') tulos.kuoppa++; else tulos.epaselva++;
    }
    for (const p of R) {
      if (p.tyyppi !== 'maki' || p.lapset.some(c => c.d < p.d)) continue;   // huippu: ei matalampaa rengasta sisällä
      let F = p;
      while (F.ylempi && F.ylempi.tyyppi === 'maki' && F.ylempi.d > F.d) F = F.ylempi;
      const ala = tasot.filter(d => d < p.d).pop() || 0, nousu = F.d - p.d;
      const luokka = p.d >= min && p.d <= max ? 'vali' : ala >= 3 && nousu >= nousuM ? 'nousu' : null;
      if (!luokka) continue;
      let sa = 0, so = 0; const n = p.ll.length / 2;
      for (let i = 0; i < p.ll.length; i += 2) { sa += p.ll[i]; so += p.ll[i + 1]; }
      tulos.matalikot.push({ d: p.d, ala, ymparisto: F.d, nousu, luokka, ll: p.ll, la0: p.la0, la1: p.la1, lo0: p.lo0, lo1: p.lo1, keski: [sa / n, so / n] });
    }
    return tulos;
  }
  /** Matalikko pisteessä: pienin, jonka huippurenkaan sisällä piste on (tai null). */
  function matalikkoPisteessa(lista, lat, lon) {
    let paras = null;
    for (const m of lista || []) {
      if (lat < m.la0 || lat > m.la1 || lon < m.lo0 || lon > m.lo1 || !renkaanSisalla(m.ll, lat, lon)) continue;
      if (!paras || (m.la1 - m.la0) * (m.lo1 - m.lo0) < (paras.la1 - paras.la0) * (paras.lo1 - paras.lo0)) paras = m;
    }
    return paras;
  }

  /** Oma reittijälki (v20): [[t s, lat × 1e5, lon × 1e5], …]. Osat [alku, loppu] (indeksit, mukaan lukien):
   *  katko, kun pisteiden väli on yli katkoS (näyttö oli kiinni tai GPS poissa) tai hyppy yli hyppyM. */
  function jalkiOsat(J, katkoS = 300, hyppyM = 2000) {
    const osat = [];
    if (!Array.isArray(J) || !J.length) return osat;
    let a = 0;
    for (let i = 1; i < J.length; i++) {
      const p = J[i - 1], q = J[i];
      const m = Math.hypot((q[1] - p[1]) / 1e5 * KM_LAT, (q[2] - p[2]) / 1e5 * kmLon(p[1] / 1e5)) * 1000;
      if (q[0] - p[0] > katkoS || m > hyppyM) { osat.push([a, i - 1]); a = i; }
    }
    osat.push([a, J.length - 1]);
    return osat;
  }
  /** Jäljen peittävyys iän mukaan: tuore 1,0 → 24 h vanha 0,15 (lineaarisesti). */
  function jalkiAlfa(ikaS) { return 0.15 + 0.85 * Math.max(0, Math.min(1, 1 - ikaS / 86400)); }
  /** Lähin jäljen piste: { i, m } tai null. */
  function lahinJalki(J, lat, lon) {
    if (!Array.isArray(J) || !J.length) return null;
    const kx = kmLon(lat) * 1000, ky = KM_LAT * 1000;
    let paras = null;
    for (let i = 0; i < J.length; i++) {
      const m = Math.hypot((J[i][1] / 1e5 - lat) * ky, (J[i][2] / 1e5 - lon) * kx);
      if (!paras || m < paras.m) paras = { i, m };
    }
    return paras;
  }
  function aaltoVari(h) {
    const raja = [[0.25, '64,140,255'], [0.5, '60,200,160'], [0.75, '170,220,60'], [1.0, '250,210,40'], [1.5, '255,140,30'], [99, '235,50,40']];
    for (const [r, c] of raja) if (h < r) return c;
    return '235,50,40';
  }

  // ------------------------------------------------------------ piirto
  class Kartta {
    constructor(canvas, opts) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.lat = opts.lat; this.lon = opts.lon; this.z = opts.z || 11;
      this.data = null; this.aika = 0; this.askel = opts.askel || 0.2;
      this.lohiVali = opts.lohiVali || [6.6, 8.8];
      this.aaltoRajat = opts.aaltoRajat || [0.35, 0.5];   // merkitsevä aallonkorkeus (m)
      this.tasot = { lampo: true, lohi: true, syvyys: true, tuuli: true, vaylat: true, havainnot: true, aaltoraja: true, jalki: true, matalikot: true, ais: false, sst: false, virta: true, aalto: false, tausta: true };
      this.syvyys = null;   // puraSyvyys()-tulos
      this.vaylat = null;   // puraVaylat()-tulos
      this.ylaVara = 0; this.alaVara = 0;   // ohjainten peittämä osa ylhäällä ja alhaalla (px)
      this._seliteAsti = 0;
      this.merkit = opts.merkit || []; this.oma = null; this.valittu = null;
      this.havainnot = opts.havainnot || [];   // havainnot.js
      this.jalki = opts.jalki || [];   // oma reittijälki 24 h (v20)
      this.matalikot = []; this.matalikkoVali = '10–20';
      this.ais = [];   // AIS-kohteet (v23): [{ lat, lon, t, sog, cog, suunta, liikkuu, vari, nimi }]   // matalikot()-tuloksen lista ja selitteen väli (v21)
      this.laatat = new Map(); this.onNapautus = opts.onNapautus || (() => {});
      this.osoittimet = new Map(); this.raahattu = false;
      this._kuuntele();
      this.koko();
    }
    koko() {
      const r = this.c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
      this.ctx.setTransform(d, 0, 0, d, 0, 0);
      this.piirra();
    }
    ruutu(lat, lon) {
      return [lonX(lon, this.z) - lonX(this.lon, this.z) + this.w / 2, latY(lat, this.z) - latY(this.lat, this.z) + this.h / 2];
    }
    paikka(x, y) {
      return [yLat(latY(this.lat, this.z) + y - this.h / 2, this.z), xLon(lonX(this.lon, this.z) + x - this.w / 2, this.z)];
    }
    zoomaa(dz, x, y) {
      x = x ?? this.w / 2; y = y ?? this.h / 2;
      const [la, lo] = this.paikka(x, y);
      this.z = Math.max(6, Math.min(15, this.z + dz));
      const [x2, y2] = this.ruutu(la, lo);
      this._siirra(x2 - x, y2 - y);
      this.piirra();
    }
    _siirra(dx, dy) {
      this.lat = yLat(latY(this.lat, this.z) + dy, this.z);
      this.lon = xLon(lonX(this.lon, this.z) + dx, this.z);
    }
    keskita(lat, lon) { this.lat = lat; this.lon = lon; this.piirra(); }

    _kuuntele() {
      const c = this.c;
      c.style.touchAction = 'none';
      c.addEventListener('pointerdown', e => {
        c.setPointerCapture(e.pointerId);
        this.osoittimet.set(e.pointerId, { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY });
        this.raahattu = false;
      });
      c.addEventListener('pointermove', e => {
        const p = this.osoittimet.get(e.pointerId); if (!p) return;
        if (this.osoittimet.size === 1) {
          if (Math.hypot(e.offsetX - p.x0, e.offsetY - p.y0) > 6) this.raahattu = true;
          this._siirra(p.x - e.offsetX, p.y - e.offsetY);
          p.x = e.offsetX; p.y = e.offsetY; this.piirra();
        } else if (this.osoittimet.size === 2) {
          const [a, b] = [...this.osoittimet.values()];
          const ennen = Math.hypot(a.x - b.x, a.y - b.y);
          p.x = e.offsetX; p.y = e.offsetY;
          const jalkeen = Math.hypot(a.x - b.x, a.y - b.y);
          this.raahattu = true;
          if (ennen > 0 && jalkeen > 0) this.zoomaa(Math.log2(jalkeen / ennen), (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
      });
      const loppu = e => {
        const p = this.osoittimet.get(e.pointerId);
        this.osoittimet.delete(e.pointerId);
        if (p && !this.raahattu && this.osoittimet.size === 0) {
          const a = this._profiiliAlue;
          if (a && e.offsetX >= a.x && e.offsetX <= a.x + a.w && e.offsetY >= a.y && e.offsetY <= a.y + a.h) {
            this.valittu = null; this._profiiliAlue = null; this.piirra(); this.onNapautus(null, null); return;   // profiili kiinni
          }
          const [la, lo] = this.paikka(e.offsetX, e.offsetY);
          this.valittu = [la, lo]; this.piirra(); this.onNapautus(la, lo);
        }
      };
      c.addEventListener('pointerup', loppu);
      c.addEventListener('pointercancel', e => this.osoittimet.delete(e.pointerId));
      c.addEventListener('wheel', e => { e.preventDefault(); this.zoomaa(e.deltaY < 0 ? 0.5 : -0.5, e.offsetX, e.offsetY); }, { passive: false });
      window.addEventListener('resize', () => this.koko());
    }

    _laatta(z, x, y) {
      const k = z + '/' + x + '/' + y;
      if (this.laatat.has(k)) return this.laatat.get(k);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => this.piirra();
      img.onerror = () => { img._virhe = true; };
      img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      this.laatat.set(k, img);
      if (this.laatat.size > 400) this.laatat.delete(this.laatat.keys().next().value);
      return img;
    }

    piirra() {
      if (!this._piirtoPyydetty) {
        this._piirtoPyydetty = true;
        (root.requestAnimationFrame || (f => setTimeout(f, 16)))(() => { this._piirtoPyydetty = false; this._piirra(); });
      }
    }

    _piirra() {
      const g = this.ctx, w = this.w, h = this.h;
      g.fillStyle = '#0d2236'; g.fillRect(0, 0, w, h);
      this._aloitaNimet();
      if (this.tasot.tausta) this._tausta();
      const d = this.data;
      if (d) {
        if (this.tasot.aalto && d.wav) this._aalto();
        if (this.tasot.lohi && d.phy && d.phy.profiili) this._lohi();
        if (this.tasot.aaltoraja && d.wav) this._aaltoraja();   // lämpö- ja syvyyskäyrät piirtyvät päälle
      }
      if (d) {
        if (this.tasot.lampo && d.phy) this._kayrat(d.phy, 'lampo', this.aika, false);
        if (this.tasot.sst && d.sst) this._kayrat(d.sst, 'lampo', 0, true);
      }
      if (this.tasot.syvyys && this.syvyys) this._syvyys();   // lämpökäyrien päälle: 20 m ja 6 m erottuvat
      if (this.tasot.matalikot && this.matalikot.length) this._matalikot();
      if (this.tasot.vaylat && this.vaylat) this._vaylat();
      if (this.tasot.havainnot && this.havainnot.length) this._havainnot();   // virta- ja tuulinuolten alle
      if (d && this.tasot.virta && d.phy) this._virta();
      if (d && this.tasot.tuuli && d.tuuli) this._tuuli();
      if (this.tasot.jalki && this.jalki.length > 1) this._jalki();   // nuolten päälle, merkkien alle
      if (this.tasot.ais && this.ais.length) this._ais();
      this._merkit();
      this._piirraNimet();   // kaikkien tasojen numerot ja nimet tärkeysjärjestyksessä, ei päällekkäin (v16)
      this._profiiliAlue = null;
      const profiili = d && this.tasot.lohi && this.valittu ? this._profiili() : false;
      if (!profiili && Date.now() < this._seliteAsti) this._selite();   // selite 3 s; ei profiilin kanssa
      this._lahteet();
    }

    /** Nimijono (v16, Hannu 13.11.: numerot menivät päällekkäin). Tasot lisäävät nimet jonoon, _piirraNimet piirtää
     *  ne lopuksi tärkeysjärjestyksessä (pienempi prio ensin) ja jättää pois nimen, joka osuisi jo piirrettyyn
     *  nimeen, merkkiin tai ohjaimiin. Nimellä voi olla useita paikkoja: ensimmäinen vapaa käytetään. */
    _aloitaNimet() {
      this._nimet = [];
      const yla = this.ylaVara, ala = this.alaVara;
      this._varatut = [
        { x: 0, y: 0, w: this.w, h: yla + 2 },                          // ohjaimet ylhäällä
        { x: 0, y: this.h - ala - 2, w: this.w, h: ala + 2 },           // napautustieto alhaalla
        { x: this.w - 60, y: yla + 4, w: 60, h: 160 },                  // zoom-napit
        { x: this.w - 330, y: this.h - ala - 20, w: 330, h: 18 }        // lähdemaininta
      ];
      if (this.valittu && this.tasot.lohi && this.data && this.data.phy) this._varatut.push({ x: 8, y: yla + 8, w: 132, h: 156 });   // profiili
    }
    _varaa(x, y, w, h) { if (this._varatut) this._varatut.push({ x, y, w, h }); }
    /** rivit: teksti tai taulukko riveistä; paikat: [[x, y], ...] (y = ensimmäisen rivin perusviiva). */
    _nimi(rivit, paikat, vari, prio, o = {}) {
      if (!this._nimet) return;
      this._nimet.push({ rivit: Array.isArray(rivit) ? rivit : [rivit], paikat, vari, prio, font: o.font || 'bold 12px sans-serif',
        tasaus: o.tasaus || 'left', reuna: o.reuna || 'rgba(0,0,0,0.85)', rk: o.rk || 14, ryhma: o.ryhma, max: o.max });
    }
    _piirraNimet() {
      if (!this._nimet || !this._nimet.length) return;
      const g = this.ctx, V = 1, varatut = this._varatut, maara = {};
      const osuu = q => varatut.some(v => q.x < v.x + v.w + V && q.x + q.w + V > v.x && q.y < v.y + v.h + V && q.y + q.h + V > v.y);
      const lista = this._nimet.map((n, i) => [n, i]).sort((a, b) => a[0].prio - b[0].prio || a[1] - b[1]);
      g.save(); g.lineJoin = 'round'; g.lineWidth = 3;
      this.nimiaPiirretty = 0; this.nimiaPois = 0; this.nimiRuudut = [];   // testejä ja vianetsintää varten
      for (const [n] of lista) {
        if (n.ryhma && n.max && (maara[n.ryhma] || 0) >= n.max) continue;
        g.font = n.font;
        const lev = Math.max(...n.rivit.map(t => g.measureText(t).width)), kork = n.rivit.length * n.rk;
        let piirretty = false;
        for (const [x, y] of n.paikat) {
          const q = { x: n.tasaus === 'center' ? x - lev / 2 : n.tasaus === 'right' ? x - lev : x, y: y - n.rk + 3, w: lev, h: kork };
          if (q.x > this.w || q.x + q.w < 0 || osuu(q)) continue;
          varatut.push(q); piirretty = true; this.nimiRuudut.push({ q, teksti: n.rivit.join(' / '), prio: n.prio });
          if (n.ryhma) maara[n.ryhma] = (maara[n.ryhma] || 0) + 1;
          g.textAlign = n.tasaus;
          n.rivit.forEach((t, k) => { g.strokeStyle = n.reuna; g.strokeText(t, x, y + k * n.rk); g.fillStyle = n.vari; g.fillText(t, x, y + k * n.rk); });
          break;
        }
        if (piirretty) this.nimiaPiirretty++; else this.nimiaPois++;
      }
      g.restore();
    }

    /** Selite näkyviin ms millisekunniksi (Hannu 10.11.: sulkeutuu 3 s jälkeen). 0 = piiloon heti. */
    naytaSelite(ms) {
      this._seliteAsti = ms > 0 ? Date.now() + ms : 0;
      clearTimeout(this._seliteAjastin);
      if (ms > 0) this._seliteAjastin = setTimeout(() => this.piirra(), ms + 30);
      this.piirra();
    }

    /** Lähdemaininnat oikeaan alakulmaan (OSM ja käytössä olevat aineistot). */
    _lahteet() {
      const osat = ['© OpenStreetMap'];
      if (this.tasot.syvyys && this.syvyys) osat.push('syvyys Traficom');
      if (this.tasot.vaylat && this.vaylat) osat.push('väylät Väylävirasto');
      if (this.tasot.ais && this.ais.length) osat.push('AIS Fintraffic');
      if (this.syvyys || this.vaylat) osat.push('ei navigointiin');
      const g = this.ctx, txt = osat.join(' · ');
      g.save(); g.font = '10px sans-serif'; g.textAlign = 'right';
      const y = this.h - this.alaVara - 5, lev = g.measureText(txt).width;
      g.fillStyle = 'rgba(5,15,28,0.6)'; g.fillRect(this.w - lev - 10, y - 11, lev + 8, 15);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(txt, this.w - 6, y);
      g.restore();
    }

    /** Väylät: väyläalueiden reunat ja navigointilinjat katkoviivana, kulkusyvyys numerona. */
    _vaylat() {
      const g = this.ctx, s = Math.pow(2, this.z);
      const ox = lonX(this.lon, this.z) - this.w / 2, oy = latY(this.lat, this.z) - this.h / 2;
      const [laY, loV] = this.paikka(-40, -40), [laA, loO] = this.paikka(this.w + 40, this.h + 40);
      const nakyy = v => !(v.la1 < laA || v.la0 > laY || v.lo1 < loV || v.lo0 > loO);
      const viiva = v => { const m = v.m; g.moveTo(m[0] * s - ox, m[1] * s - oy); for (let k = 2; k < m.length; k += 2) g.lineTo(m[k] * s - ox, m[k + 1] * s - oy); };
      g.save(); g.lineJoin = 'round';
      g.strokeStyle = 'rgba(255,209,102,0.75)'; g.lineWidth = 1.2; g.setLineDash([4, 4]);
      g.beginPath(); for (const v of this.vaylat.alueet) if (nakyy(v)) viiva(v); g.stroke();
      g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.setLineDash([10, 6]);
      g.beginPath(); for (const v of this.vaylat.linjat) if (nakyy(v)) viiva(v); g.stroke();
      g.setLineDash([]);
      if (this.z >= 11.5) {   // mitoitussyväys numerona vasta lähempää (v16); napautus kertoo aina
        const nahty = new Set();
        for (const v of this.vaylat.alueet.concat(this.vaylat.linjat)) {
          if (v.syvyys === null || v.syvyys === undefined || !nakyy(v)) continue;
          const m = v.m, i = (m.length >> 2) * 2, x = m[i] * s - ox, y = m[i + 1] * s - oy;
          const txt = String(v.syvyys).replace('.', ',') + ' m', avain = txt + Math.round(x / 40) + ',' + Math.round(y / 40);
          if (nahty.has(avain)) continue; nahty.add(avain);   // sama numero lähes samassa kohdassa (alue + linja) kerran
          this._nimi(txt, [[x + 3, y - 3], [x + 3, y + 13], [x - 3, y - 3]], '#ffd166', 4, { font: 'bold 11px sans-serif', tasaus: 'left', ryhma: 'vayla', max: 20 });
        }
      }
      g.restore();
    }

    /** Tuulinuolet (IL:n ennuste pisteissä): nuoli myötätuuleen, väri nopeuden mukaan, luku "keski (puuska)". */
    _tuuli() {
      const tu = this.data.tuuli, g = this.ctx;
      if (!tu.ajat || !tu.ajat.length) return;
      const ajat = this.data.ajat || (this.data.phy && this.data.phy.ajat) || [];
      const ti = lahinAika(tu.ajat, Date.parse(ajat[this.aika] || tu.ajat[0]));
      g.save(); g.lineCap = 'round';
      tu.pisteet.forEach(([la, lo], i) => {
        const ws = tu.ws[ti] && tu.ws[ti][i], wd = tu.wd[ti] && tu.wd[ti][i], wg = tu.wg[ti] && tu.wg[ti][i];
        if (ws === null || ws === undefined || wd === null || wd === undefined) return;
        const [x, y] = this.ruutu(la, lo);
        if (x < -30 || y < this.ylaVara - 30 || x > this.w + 30 || y > this.h - this.alaVara + 30) return;
        const vari = tuuliVari(ws), k = (wd + 180) * Math.PI / 180, L = 30;   // tuulee kohti (wd + 180)
        const dx = Math.sin(k), dy = -Math.cos(k);
        const x1 = x - dx * L / 2, y1 = y - dy * L / 2, x2 = x + dx * L / 2, y2 = y + dy * L / 2;
        for (const [lev, c] of [[5, 'rgba(0,0,0,0.75)'], [2.4, vari]]) {
          g.strokeStyle = c; g.lineWidth = lev;
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
          g.moveTo(x2, y2); g.lineTo(x2 - 9 * Math.sin(k - 0.5), y2 + 9 * Math.cos(k - 0.5));
          g.moveTo(x2, y2); g.lineTo(x2 - 9 * Math.sin(k + 0.5), y2 + 9 * Math.cos(k + 0.5));
          g.stroke();
        }
        const txt = Math.round(ws) + (wg !== null && wg !== undefined ? ' (' + Math.round(wg) + ')' : '');
        this._nimi(txt, [[x1 + 4, y1 + 14], [x2 + 4, y2 + 14], [x1 + 4, y1 - 6]], vari, 1);
      });
      g.restore();
    }

    /** Syvyyskäyrät: kaikki ohuina, 6 m keskivahvana, 20 m vahvana (Hannun valinta 10.11.). */
    _syvyys() {
      const g = this.ctx, s = Math.pow(2, this.z);
      const ox = lonX(this.lon, this.z) - this.w / 2, oy = latY(this.lat, this.z) - this.h / 2;
      const [laY, loV] = this.paikka(-40, -40), [laA, loO] = this.paikka(this.w + 40, this.h + 40);
      const tyyli = d => d === 20 ? ['#ff5ad6', 2.8, 1] : d === 6 ? ['#e3ebff', 1.7, 0.9] : ['#c3cedd', 0.9, 0.5];
      const ehdokkaat = [];
      g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
      for (const taso of this.syvyys.tasot) {
        const [vari, lev, alfa] = tyyli(taso.syvyys);
        g.strokeStyle = vari; g.lineWidth = lev; g.globalAlpha = alfa;
        g.beginPath();
        for (const v of taso.viivat) {
          if (v.la1 < laA || v.la0 > laY || v.lo1 < loV || v.lo0 > loO) continue;
          const m = v.m;
          const vali = taso.syvyys === 20 || taso.syvyys === 6 ? 260 : 600;   // muiden käyrien numerot harvemmin
          let px = m[0] * s - ox, py = m[1] * s - oy, kuljettu = vali / 2;
          g.moveTo(px, py);
          for (let k = 2; k < m.length; k += 2) {
            const x = m[k] * s - ox, y = m[k + 1] * s - oy;
            g.lineTo(x, y);
            kuljettu += Math.hypot(x - px, y - py); px = x; py = y;
            if (kuljettu >= vali && x > 20 && x < this.w - 70 && y > this.ylaVara + 16 && y < this.h - this.alaVara - 24) { ehdokkaat.push([taso.syvyys, x, y, vari]); kuljettu = 0; }
          }
        }
        g.stroke();
      }
      // numerot jonoon: 20 m ennen 6 m:ä ennen muita; ryhmittäiset enimmäismäärät (v16)
      g.globalAlpha = 1;
      for (const [d, x, y, vari] of ehdokkaat) {
        const muu = d !== 20 && d !== 6;
        if (muu && this.z < 11) continue;
        this._nimi(String(d).replace('.', ','), [[x + 2, y - 2]], vari, d === 20 ? 5 : d === 6 ? 5.5 : 6,
          { font: 'bold 11px sans-serif', reuna: 'rgba(0,0,0,0.8)', ryhma: 'syv' + (muu ? 'muu' : d), max: d === 20 ? 14 : d === 6 ? 10 : 8 });
      }
      g.restore();
    }

    /** Lohikerroksen luokat ruuduittain (välimuisti: sama data, aika ja lämpöväli). */
    _lohiRuudut() {
      const p = this.data.phy, t = this.aika, [a, b] = this.lohiVali;
      const avain = t + '|' + a + '|' + b;
      if (this._lohiV && this._lohiV.data === this.data && this._lohiV.avain === avain) return this._lohiV.ruudut;
      const pr = p.profiili[t]; if (!pr) return null;
      const ruudut = [];
      for (let i = 0; i < p.lat.length; i++) {
        const rivi = [];
        for (let j = 0; j < p.lon.length; j++) rivi.push(lohiLuokka(kerros(pr.map(taso => taso[i][j]), p.syvyydet, a, b)));
        ruudut.push(rivi);
      }
      this._lohiV = { data: this.data, avain, ruudut };
      return ruudut;
    }

    _lohi() {
      const p = this.data.phy, g = this.ctx, ruudut = this._lohiRuudut(); if (!ruudut) return;
      const VARI = { optimi: 'rgba(60,220,120,0.30)', keski: 'rgba(240,210,60,0.26)', syva: 'rgba(255,140,40,0.26)', ei: 'rgba(150,160,170,0.12)' };
      const dl = Math.abs(p.lat[1] - p.lat[0]) / 2, dn = Math.abs(p.lon[1] - p.lon[0]) / 2;
      for (let i = 0; i < p.lat.length; i++) for (let j = 0; j < p.lon.length; j++) {
        const l = ruudut[i][j]; if (!l) continue;
        const [x1, y1] = this.ruutu(p.lat[i] + dl, p.lon[j] - dn), [x2, y2] = this.ruutu(p.lat[i] - dl, p.lon[j] + dn);
        if (x2 < 0 || y2 < 0 || x1 > this.w || y1 > this.h) continue;
        g.fillStyle = VARI[l]; g.fillRect(x1, y1, x2 - x1 + 0.6, y2 - y1 + 0.6);
      }
    }

    /** Valitun pisteen lämpöprofiili pienenä kuvana vasempaan yläkulmaan. */
    _profiili() {
      const pr = profiiliPisteessa(this.data.phy, this.aika, this.valittu[0], this.valittu[1]);
      if (!pr) return false;
      const pts = [];
      for (let k = 0; k < pr.syvyydet.length; k++) { const v = pr.arvot[k]; if (v === null || !isFinite(v)) break; pts.push([pr.syvyydet[k], v]); }
      if (!pts.length) return false;
      const [a, b] = this.lohiVali, k = kerros(pr.arvot, pr.syvyydet, a, b);
      const g = this.ctx, X = 8, Y = this.ylaVara + 8, W = 132, H = 156;
      const dMax = pr.syvyydet[pr.syvyydet.length - 1];
      const arvot = pts.map(q => q[1]);
      const tLo = Math.min(a, ...arvot) - 0.3, tHi = Math.max(b, ...arvot) + 0.3;
      const px = { x0: X + 30, x1: X + W - 8, y0: Y + 22, y1: Y + H - 20 };
      const xT = v => px.x0 + (v - tLo) / (tHi - tLo) * (px.x1 - px.x0);
      const yD = d => px.y0 + d / dMax * (px.y1 - px.y0);
      g.save();
      g.fillStyle = 'rgba(5,15,28,0.88)'; g.fillRect(X, Y, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
      g.font = 'bold 12px sans-serif'; g.fillStyle = '#e9f1f7'; g.fillText('Profiili (malli)', X + 6, Y + 15);
      g.font = 'bold 15px sans-serif'; g.fillStyle = '#8fa6ba'; g.fillText('×', X + W - 14, Y + 15);   // napautus sulkee
      this._profiiliAlue = { x: X, y: Y, w: W, h: H };
      // lämpöväli
      g.fillStyle = 'rgba(60,220,120,0.22)'; g.fillRect(xT(a), px.y0, xT(b) - xT(a), px.y1 - px.y0);
      // 0–3 m optimi
      g.strokeStyle = 'rgba(126,217,87,0.8)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px.x0, yD(3)); g.lineTo(px.x1, yD(3)); g.stroke(); g.setLineDash([]);
      // syvyysakseli
      g.font = '10px sans-serif'; g.fillStyle = '#8fa6ba';
      for (const d of [0, 3, 6, 9, 12]) if (d <= dMax + 0.01) g.fillText(d + ' m', X + 3, yD(d) + 3);
      g.fillText(tLo.toFixed(1).replace('.', ','), px.x0 - 6, px.y1 + 13);
      g.fillText(tHi.toFixed(1).replace('.', ',') + ' °C', px.x1 - 34, px.y1 + 13);
      // merenpohja
      if (pts.length < pr.syvyydet.length) {
        g.fillStyle = 'rgba(140,100,60,0.55)'; const yp = yD(pts[pts.length - 1][0] + 0.5);
        g.fillRect(px.x0, yp, px.x1 - px.x0, px.y1 - yp);
      }
      // profiiliviiva
      g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath();
      g.moveTo(xT(pts[0][1]), yD(0));
      for (const [d, v] of pts) g.lineTo(xT(v), yD(d));
      g.stroke();
      g.fillStyle = '#ffffff'; for (const [d, v] of pts) { g.beginPath(); g.arc(xT(v), yD(d), 1.8, 0, Math.PI * 2); g.fill(); }
      // kerroksen hakasulje oikealla
      if (k && k.loytyi) {
        g.strokeStyle = '#3cdc78'; g.lineWidth = 3; const xr = px.x1 + 4;
        g.beginPath(); g.moveTo(xr - 3, yD(k.yla)); g.lineTo(xr, yD(k.yla)); g.lineTo(xr, yD(k.ala)); g.lineTo(xr - 3, yD(k.ala)); g.stroke();
      }
      g.restore();
      return true;
    }

    _tausta() {
      const g = this.ctx;
      const zt = Math.max(3, Math.min(17, Math.round(this.z)));
      const s = Math.pow(2, this.z - zt), koko = TILE * s;
      const kx = lonX(this.lon, zt) * s, ky = latY(this.lat, zt) * s;
      const x0 = Math.floor((kx - this.w / 2) / koko), x1 = Math.floor((kx + this.w / 2) / koko);
      const y0 = Math.floor((ky - this.h / 2) / koko), y1 = Math.floor((ky + this.h / 2) / koko);
      g.save(); g.globalAlpha = 0.85;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const img = this._laatta(zt, x, y);
        if (img.complete && !img._virhe && img.naturalWidth) g.drawImage(img, x * koko - kx + this.w / 2, y * koko - ky + this.h / 2, koko + 0.5, koko + 0.5);
      }
      g.restore();
      // tummennus, jotta käyrät erottuvat
      g.fillStyle = 'rgba(8,20,34,0.35)'; g.fillRect(0, 0, this.w, this.h);

    }

    _aalto() {
      const wv = this.data.wav, g = this.ctx;
      const t = lahinAika(wv.ajat, Date.parse(this.data.phy ? this.data.phy.ajat[this.aika] : wv.ajat[0]));
      const hs = wv.hs[t]; if (!hs) return;
      const dl = Math.abs(wv.lat[1] - wv.lat[0]) / 2, dn = Math.abs(wv.lon[1] - wv.lon[0]) / 2;
      for (let i = 0; i < wv.lat.length; i++) for (let j = 0; j < wv.lon.length; j++) {
        const v = hs[i][j]; if (v === null) continue;
        const [x1, y1] = this.ruutu(wv.lat[i] + dl, wv.lon[j] - dn), [x2, y2] = this.ruutu(wv.lat[i] - dl, wv.lon[j] + dn);
        if (x2 < 0 || y2 < 0 || x1 > this.w || y1 > this.h) continue;
        g.fillStyle = `rgba(${aaltoVari(v)},0.28)`; g.fillRect(x1, y1, x2 - x1 + 0.6, y2 - y1 + 0.6);
      }
    }

    /** Aaltoraja: ruudut, joissa merkitsevä aallonkorkeus ylittää rajan 1 (harva pisterasteri) tai rajan 2
     *  (punainen harva vinoviivoitus). Kuvio on kiinni kartassa, joten se ei liu'u karttaa vierittäessä. */
    _aaltoraja() {
      const wv = this.data.wav, g = this.ctx;
      const t = lahinAika(wv.ajat, Date.parse(this.data.phy ? this.data.phy.ajat[this.aika] : wv.ajat[0]));
      const hs = wv.hs[t]; if (!hs) return;
      const dl = Math.abs(wv.lat[1] - wv.lat[0]) / 2, dn = Math.abs(wv.lon[1] - wv.lon[0]) / 2;
      const alueet = [null, new Path2D(), new Path2D()], maara = [0, 0, 0];
      for (let i = 0; i < wv.lat.length; i++) for (let j = 0; j < wv.lon.length; j++) {
        const l = aaltoLuokka(hs[i][j], this.aaltoRajat); if (!l) continue;
        const [x1, y1] = this.ruutu(wv.lat[i] + dl, wv.lon[j] - dn), [x2, y2] = this.ruutu(wv.lat[i] - dl, wv.lon[j] + dn);
        if (x2 < 0 || y2 < 0 || x1 > this.w || y1 > this.h) continue;
        alueet[l].rect(x1, y1, x2 - x1 + 0.6, y2 - y1 + 0.6); maara[l]++;
      }
      this.aaltorajaRuutuja = maara;
      const ox = lonX(this.lon, this.z) - this.w / 2, oy = latY(this.lat, this.z) - this.h / 2;
      const S = 16, mod = (a, b) => ((a % b) + b) % b;   // harva: pisteet 16 px, viivat 22 px välein
      if (maara[1]) {   // taso 1: harva pisterasteri
        g.save(); g.clip(alueet[1]);
        for (let x = -mod(ox, S); x < this.w + S; x += S) for (let y = -mod(oy, S); y < this.h + S; y += S) {
          g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x - 2, y - 2, 4, 4);
          g.fillStyle = 'rgba(255,213,74,0.95)'; g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
        }
        g.restore();
      }
      if (maara[2]) {   // taso 2: punainen harva vinoviivoitus (viivat x - y = vakio kartan koordinaateissa)
        const V = 22;
        g.save(); g.clip(alueet[2]); g.lineCap = 'butt';
        for (const [lev, vari] of [[3.6, 'rgba(0,0,0,0.45)'], [1.8, 'rgba(255,60,60,0.95)']]) {
          g.strokeStyle = vari; g.lineWidth = lev; g.beginPath();
          for (let c = -mod(ox - oy, V) - this.h; c < this.w + V; c += V) { g.moveTo(c, 0); g.lineTo(c + this.h, this.h); }
          g.stroke();
        }
        g.restore();
      }
    }

    _kayrat(lahde, kentta, t, katko) {
      const z = lahde[kentta][t]; if (!z) return;
      const [min, max] = arvovali(z);
      const askel = this.askel;
      const lista = tasot(min, max, askel);
      const g = this.ctx;
      g.save();
      g.setLineDash(katko ? [6, 4] : []);
      const nimiVali = Math.max(askel * 5, 0.5); // nimetään joka 1,0 °C (askel 0,2)
      for (const taso of lista) {
        const janat = kayra(z, lahde.lat, lahde.lon, taso);
        const paa = Math.abs(taso / nimiVali - Math.round(taso / nimiVali)) < 1e-6;
        g.strokeStyle = katko ? 'rgba(255,255,255,0.8)' : lampoVari(taso, min, max);
        g.lineWidth = paa ? 2.6 : 1.3;
        g.beginPath();
        const kohdat = [];   // nimen paikkaehdokkaat käyrällä, vähintään 110 px välein
        for (const [la1, lo1, la2, lo2] of janat) {
          const [x1, y1] = this.ruutu(la1, lo1), [x2, y2] = this.ruutu(la2, lo2);
          g.moveTo(x1, y1); g.lineTo(x2, y2);
          if (paa && kohdat.length < 12 && x1 > 10 && x1 < this.w - 40 && y1 > this.ylaVara + 16 && y1 < this.h - this.alaVara - 8 &&
              kohdat.every(([a, b]) => Math.hypot(a - x1 - 3, b - y1 + 3) > 110)) kohdat.push([x1 + 3, y1 - 3]);
        }
        g.stroke();
        const kx = this.w / 2, ky = (this.ylaVara + this.h - this.alaVara) / 2;   // keskeltä alkaen: reunoilla nimet jäävät selitteen ja ohjainten alle
        kohdat.sort((a, b) => Math.hypot(a[0] - kx, a[1] - ky) - Math.hypot(b[0] - kx, b[1] - ky));
        if (kohdat.length) this._nimi(taso.toFixed(1).replace('.', ','), kohdat, katko ? '#fff' : lampoVari(taso, min, max), katko ? 3.5 : 3,
          { font: 'bold 13px sans-serif', reuna: 'rgba(0,0,0,0.8)' });
      }
      g.restore();
      this._lampoVali = katko ? this._lampoVali : [min, max];
    }

    _virta() {
      const p = this.data.phy, g = this.ctx, t = this.aika;
      if (!p.u || !p.u[t]) return;
      const [xa] = this.ruutu(p.lat[0], p.lon[0]), [xb] = this.ruutu(p.lat[0], p.lon[1]);
      const solu = Math.abs(xb - xa);
      const harvennus = Math.max(1, Math.ceil(34 / Math.max(solu, 1)));
      const pituus = solu * harvennus * 0.85;
      g.save(); g.strokeStyle = 'rgba(120,235,255,0.95)'; g.fillStyle = 'rgba(120,235,255,0.95)'; g.lineWidth = 1.6;
      for (let i = 0; i < p.lat.length; i += harvennus) for (let j = 0; j < p.lon.length; j += harvennus) {
        const u = p.u[t][i][j], v = p.v[t][i][j];
        if (u === null || v === null) continue;
        const nop = Math.hypot(u, v); if (nop < 0.01) continue;
        const [x, y] = this.ruutu(p.lat[i], p.lon[j]);
        if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) continue;
        const l = pituus * Math.min(1.3, nop / 0.25);
        const ax = x + u / nop * l, ay = y - v / nop * l;
        g.beginPath(); g.moveTo(x, y); g.lineTo(ax, ay); g.stroke();
        const k = Math.atan2(ay - y, ax - x);
        g.beginPath(); g.moveTo(ax, ay);
        g.lineTo(ax - 6 * Math.cos(k - 0.45), ay - 6 * Math.sin(k - 0.45));
        g.lineTo(ax - 6 * Math.cos(k + 0.45), ay - 6 * Math.sin(k + 0.45)); g.closePath(); g.fill();
      }
      g.restore();
    }

    /** Omat havainnot: viiva = ±leveys_km vyöhyke (vahvempi, mitä useampi havainto), alue = ellipsi rajausruudusta,
     *  kaista = pystykaista, piste = vinoneliö, saalis = punainen ympyrä. */
    _havainnot() {
      const g = this.ctx, yla = this.ylaVara + 4, ala = this.h - this.alaVara - 4;
      const kmPx = lat => Math.abs(this.ruutu(lat + 1 / KM_LAT, this.lon)[1] - this.ruutu(lat, this.lon)[1]);
      g.save(); g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineCap = 'round';
      const teksti = (t, x, y, c, prio = 2, paikat = null) => this._nimi(t, paikat || [[x, y]], 'rgb(' + c + ')', prio, { tasaus: g.textAlign });
      const nakyy = (x, y, m) => x > -m && x < this.w + m && y > yla - m && y < ala + m;
      const saaliit = [];
      for (const h of this.havainnot) {
        const c = havaintoVari(h.laji);
        if (h.tyyppi === 'viiva') {
          const P = h.pisteet.map(([la, lo]) => this.ruutu(la, lo));
          if (!P.some(([x, y]) => nakyy(x, y, 300))) continue;
          // osat vahvistusryhmittäin, jotta päällekkäiset puoliläpinäkyvät palat eivät tummu
          let osa = null; const osat = [];
          for (let k = 0; k + 1 < P.length; k++) {
            const r = vahvistusRyhma(h, (h.pisteet[k][0] + h.pisteet[k + 1][0]) / 2);
            if (!osa || osa.r !== r) { osa = { r, p: [P[k]] }; osat.push(osa); }
            osa.p.push(P[k + 1]);
          }
          const lev = 2 * (h.leveys_km || 1) * kmPx(h.pisteet[0][0]);
          const polku = p => { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (const [x, y] of p.slice(1)) g.lineTo(x, y); };
          // pohja: koko vyöhyke yhtenä haaleana (pyöreät päät vain viivan päissä)
          g.strokeStyle = 'rgba(' + c + ',0.10)'; g.lineWidth = lev; g.lineCap = 'round'; polku(P); g.stroke();
          // vahvistetut osat tummemmiksi (suorat päät, ettei ryhmien rajoille tule läikkiä)
          g.lineCap = 'butt';
          for (const o of osat) {
            const heikko = !o.r || o.r.heikko, n = o.r ? parseInt(o.r.n, 10) || 1 : 1;
            if (!heikko) { g.strokeStyle = 'rgba(' + c + ',' + Math.min(0.22, 0.04 * n) + ')'; g.lineWidth = lev; polku(o.p); g.stroke(); }
            g.strokeStyle = 'rgba(' + c + ',' + (heikko ? 0.55 : 0.95) + ')'; g.lineWidth = heikko ? 1.5 : 2.2;
            g.setLineDash(heikko ? [3, 6] : [10, 6]); polku(o.p); g.stroke(); g.setLineDash([]);
          }
          g.lineCap = 'round';
          // nimi keskiviivalle: ehdokkaat näkyvistä pisteistä, lähimpänä ruudun keskeä ensin
          const ehd = P.filter(([x, y]) => nakyy(x, y, -20)).sort((a, b) => Math.hypot(a[0] - this.w / 2, a[1] - (yla + ala) / 2) - Math.hypot(b[0] - this.w / 2, b[1] - (yla + ala) / 2));
          const lev2 = g.measureText(h.nimi).width / 2 + 6;
          if (ehd.length) { g.textAlign = 'center'; teksti(h.nimi, 0, 0, c, 2, ehd.map(([x, y]) => [Math.min(Math.max(x, lev2), this.w - lev2 - 60), y - 8])); }
        } else if (h.tyyppi === 'alue') {
          const piirraEllipsi = (la, lo, tayta, katko) => {
            const [x0, y0] = this.ruutu(la[1], lo[0]), [x1, y1] = this.ruutu(la[0], lo[1]);
            const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
            if (!nakyy(cx, cy, Math.max(rx, ry) + 40)) return null;
            g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            if (tayta) { g.fillStyle = 'rgba(' + c + ',0.20)'; g.fill(); }
            g.strokeStyle = 'rgba(' + c + ',0.95)'; g.lineWidth = tayta ? 2.2 : 1.5; g.setLineDash(katko); g.stroke(); g.setLineDash([]);
            return [cx, cy];
          };
          if (h.reuna) piirraEllipsi(h.reuna.lat, h.reuna.lon, false, [3, 5]);
          const k = piirraEllipsi(h.lat, h.lon, true, [8, 5]);
          if (k) { g.textAlign = 'center'; this._nimi(h.lyhyt ? [h.nimi, h.lyhyt] : h.nimi, [[k[0], k[1] - 2], [k[0], k[1] - 30], [k[0], k[1] + 26]], 'rgb(' + c + ')', 2, { tasaus: 'center' }); }
        } else if (h.tyyppi === 'kaista') {
          const [x0, y0] = this.ruutu(h.lat[1], h.lon[0]), [x1, y1] = this.ruutu(h.lat[0], h.lon[1]);
          if (x1 < 0 || x0 > this.w || y1 < yla || y0 > ala) continue;
          g.fillStyle = 'rgba(' + c + ',0.16)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
          g.strokeStyle = 'rgba(' + c + ',0.95)'; g.lineWidth = 2; g.setLineDash([8, 5]);
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.moveTo(x1, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
          const ty = Math.min(Math.max(y0 + 16, yla + 14), y1 - 6);
          g.textAlign = 'center'; teksti(h.nimi, (x0 + x1) / 2, ty, c);
        } else if (h.tyyppi === 'saalis') {
          saaliit.push(h);   // saaliit päällimmäisiksi
        } else {
          const [x, y] = this.ruutu(h.lat, h.lon);
          if (!nakyy(x, y, 60)) continue;
          g.fillStyle = 'rgb(' + c + ')'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 8, y); g.lineTo(x, y + 9); g.lineTo(x - 8, y); g.closePath(); g.fill(); g.stroke();
          this._varaa(x - 9, y - 10, 18, 20);
          g.textAlign = 'left'; teksti(h.nimi, x + 12, y + 4, c); g.textAlign = 'center';
        }
      }
      g.textAlign = 'left';
      for (const h of saaliit) {
        const [x, y] = this.ruutu(h.lat, h.lon);
        if (!nakyy(x, y, 60)) continue;
        g.fillStyle = 'rgb(' + havaintoVari('saalis') + ')'; g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill();
        this._varaa(x - 8, y - 8, 16, 16);
        this._nimi(h.nimi, [[x + 11, y + 4], [x + 11, y - 10], [x + 11, y + 18]], 'rgb(255,170,185)', 0);
      }
      g.restore();
    }

    _merkit() {
      const g = this.ctx;
      g.save(); g.font = 'bold 13px sans-serif';
      for (const m of this.merkit) {
        const [x, y] = this.ruutu(m.lat, m.lon);
        if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) continue;
        g.fillStyle = m.vari || '#ffd54a'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
        g.beginPath();
        if (m.muoto === 'kolmio') { g.moveTo(x, y - 8); g.lineTo(x + 7, y + 6); g.lineTo(x - 7, y + 6); g.closePath(); }
        else if (m.muoto === 'nelio') g.rect(x - 6, y - 6, 12, 12);
        else g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill(); g.stroke();
        this._varaa(x - 8, y - 9, 16, 17);
        this._nimi(m.nimi, [[x + 11, y + 4], [x + 11, y - 10], [x + 11, y + 18]], '#fff', 0, { font: 'bold 13px sans-serif' });
      }
      if (this.oma) {
        const [x, y] = this.ruutu(this.oma.lat, this.oma.lon);
        if (isFinite(this.oma.suunta)) {
          const k = (this.oma.suunta - 90) * Math.PI / 180;
          g.strokeStyle = '#4fc3ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 26 * Math.cos(k), y + 26 * Math.sin(k)); g.stroke();
        }
        g.fillStyle = '#4fc3ff'; g.strokeStyle = '#fff'; g.lineWidth = 2.5;
        g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      if (this.valittu) {
        const [x, y] = this.ruutu(this.valittu[0], this.valittu[1]);
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke();
      }
      g.restore();
    }

    /** Matalikot (v21): huippurengas hiekanvärisenä (huippu min–max m vahvempana, muu nousu haaleana katkoviivalla)
     *  ja nimi "▲6–10" = matalin kohta 6–10 m. */
    _matalikot() {
      const g = this.ctx, [laY, loV] = this.paikka(-40, -40), [laA, loO] = this.paikka(this.w + 40, this.h + 40);
      const f = d => String(d).replace('.', ',');
      g.save(); g.lineJoin = 'round';
      for (const m of this.matalikot) {
        if (m.la1 < laA || m.la0 > laY || m.lo1 < loV || m.lo0 > loO) continue;
        const p = new Path2D();
        for (let i = 0; i < m.ll.length; i += 2) { const [x, y] = this.ruutu(m.ll[i], m.ll[i + 1]); if (i) p.lineTo(x, y); else p.moveTo(x, y); }
        p.closePath();
        const vali = m.luokka === 'vali';
        g.fillStyle = vali ? 'rgba(255,196,90,0.45)' : 'rgba(255,196,90,0.22)'; g.fill(p);
        g.setLineDash([]); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = vali ? 4 : 3; g.stroke(p);   // tumma reuna erottaa taustasta
        g.setLineDash(vali ? [] : [5, 3]);
        g.strokeStyle = vali ? 'rgba(255,224,160,1)' : 'rgba(255,224,160,0.8)'; g.lineWidth = vali ? 2 : 1.4; g.stroke(p);
        const [x, y] = this.ruutu(m.keski[0], m.keski[1]);
        this._nimi('▲' + f(m.ala) + '–' + f(m.d), [[x + 4, y - 4], [x + 4, y + 12], [x - 40, y - 4]], '#ffe0a0', vali ? 4.2 : 4.6,
          { font: 'bold 11px sans-serif', reuna: 'rgba(0,0,0,0.85)', ryhma: 'matalikko', max: 12 });
      }
      g.restore();
    }

    /** AIS-kohteet (v23): liikkuva alus kolmiona kulkusuuntaan ja 6 min nopeusviiva, paikallaan oleva ympyränä.
     *  Yli 10 min vanha sijainti haaleana, yli 60 min ei piirretä. Väri alustyypin mukaan (ais.js). */
    _ais() {
      const g = this.ctx, nyt = Date.now();
      g.save(); g.lineJoin = 'round';
      for (const k of this.ais) {
        const ikaMin = (nyt - k.t) / 60000;
        if (!(ikaMin <= 60)) continue;
        const [x, y] = this.ruutu(k.lat, k.lon);
        if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) continue;
        g.globalAlpha = ikaMin > 10 ? 0.45 : 1;
        if (k.liikkuu && isFinite(k.cog) && k.sog > 0) {   // 6 min nopeusviiva (sog solmua)
          const m = k.sog * 1852 / 10, c = k.cog * Math.PI / 180;
          const [x2, y2] = this.ruutu(k.lat + m * Math.cos(c) / 110574, k.lon + m * Math.sin(c) / (111320 * Math.cos(k.lat * Math.PI / 180)));
          g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
          g.strokeStyle = k.vari; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        }
        g.fillStyle = k.vari; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath();
        if (k.liikkuu && isFinite(k.suunta)) {
          const a = k.suunta * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
          const p = (dx, dy) => [x + dx * c - dy * s, y + dx * s + dy * c];   // dy < 0 = keula
          const [ax, ay] = p(0, -10), [bx, by] = p(5, 7), [cx, cy] = p(-5, 7);
          g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.closePath();
        } else g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill(); g.stroke();
        this._varaa(x - 8, y - 10, 16, 18);
        if (k.nimi && this.z >= 10) this._nimi(k.nimi, [[x + 10, y - 6], [x + 10, y + 12], [x - 12, y - 14]], k.vari, 2.5,
          { font: '11px sans-serif', reuna: 'rgba(0,0,0,0.85)', ryhma: 'ais', max: 12 });
      }
      g.restore();
    }

    /** Oma reittijälki (v20): punainen, haalenee 24 tunnissa. Janat ryhmitellään tunnin ikäluokkiin
     *  (24 polkua), jotta tuhansien pisteiden jälki piirtyy nopeasti myös kartan liikkuessa. */
    _jalki() {
      const g = this.ctx, J = this.jalki, nyt = Date.now() / 1000, R = 24, ryhmat = [];
      for (let k = 0; k < R; k++) ryhmat.push([]);
      const m = 40, pois = (a, b) => (a[0] < -m && b[0] < -m) || (a[0] > this.w + m && b[0] > this.w + m) ||
        (a[1] < -m && b[1] < -m) || (a[1] > this.h + m && b[1] > this.h + m);
      for (const [a, b] of jalkiOsat(J)) {
        let ed = this.ruutu(J[a][1] / 1e5, J[a][2] / 1e5);
        for (let i = a + 1; i <= b; i++) {
          const q = this.ruutu(J[i][1] / 1e5, J[i][2] / 1e5);
          if (!pois(ed, q)) {
            const k = Math.max(0, Math.min(R - 1, Math.floor((nyt - J[i][0]) / 3600)));
            ryhmat[k].push(ed[0], ed[1], q[0], q[1]);
          }
          ed = q;
        }
      }
      g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
      for (let k = R - 1; k >= 0; k--) {   // vanhin ensin, tuorein päällimmäiseksi
        const v = ryhmat[k]; if (!v.length) continue;
        const p = new Path2D();
        for (let i = 0; i < v.length; i += 4) { p.moveTo(v[i], v[i + 1]); p.lineTo(v[i + 2], v[i + 3]); }
        const al = jalkiAlfa((k + 0.5) * 3600);
        g.strokeStyle = `rgba(10,10,10,${(0.55 * al).toFixed(3)})`; g.lineWidth = 6.5; g.stroke(p);
        g.strokeStyle = `rgba(255,59,48,${al.toFixed(3)})`; g.lineWidth = 3.5; g.stroke(p);
      }
      g.restore();
    }

    _selite() {
      // Tiivis selite: rivi = osia [teksti, tekstin väri, neliön väri]
      const d = this.data || {}, rivit = [];
      const f = x => x.toString().replace('.', ',');
      if (this.tasot.lohi && d.phy && d.phy.profiili) rivit.push([['Lohikerros alkaa', '#7ed957'],
        ['0–3', '#e9f1f7', 'rgb(60,220,120)'], ['3–6', '#e9f1f7', 'rgb(240,210,60)'], ['6–12 m', '#e9f1f7', 'rgb(255,140,40)'], ['ei', '#e9f1f7', 'rgb(110,120,130)']]);
      if (this.tasot.syvyys && this.syvyys) rivit.push([['Syvyys (Traficom)', '#c3cedd'], ['20 m', '#e9f1f7', '#ff5ad6'], ['6 m', '#e9f1f7', '#e3ebff'], ['muut', '#e9f1f7', '#8793a3']]);
      if (this.tasot.tuuli && d.tuuli) {
        rivit.push([['Tuuli (IL), nuoli myötätuuleen: m/s (puuska)', '#e8f4ff']]);
        rivit.push([['', '#e9f1f7'], ['<5', '#e9f1f7', '#e8f4ff'], ['5–8', '#e9f1f7', '#ffe066'], ['8–10', '#e9f1f7', '#ffa94d'], ['≥10 m/s', '#e9f1f7', '#ff5c5c']]);
      }
      if (this.tasot.vaylat && this.vaylat) rivit.push([['Väylä (Väylävirasto), mitoitussyväys m', '#ffd166']]);
      if (this.tasot.havainnot && this.havainnot.length) rivit.push([['Omat', 'rgb(' + havaintoVari('muu') + ')'],
        ['lämpöraja', '#e9f1f7', 'rgba(' + havaintoVari('muu') + ',0.8)'], ['lämmin', '#e9f1f7', 'rgb(' + havaintoVari('lammin') + ')'],
        ['kylmä', '#e9f1f7', 'rgb(' + havaintoVari('kylma') + ')'], ['saalis', '#e9f1f7', 'rgb(' + havaintoVari('saalis') + ')']]);
      if (this.tasot.matalikot && this.matalikot.length) rivit.push([['Matalikko (käyristä) ▲matalin', '#ffe0a0'], ['huippu ' + this.matalikkoVali + ' m', '#e9f1f7', 'rgba(255,196,90,0.85)'],
        ['muu nousu', '#e9f1f7', 'rgba(255,196,90,0.4)']]);
      if (this.tasot.ais) {
        rivit.push([['AIS', '#9fd0ff'], ['rahti', '#e9f1f7', '#9fd0ff'], ['matkustaja', '#e9f1f7', '#ffffff'], ['säiliö', '#e9f1f7', '#ffb36b'],
          ['luotsi', '#e9f1f7', '#ffe066'], ['pelastus', '#e9f1f7', '#ff6b6b']]);
        rivit.push([['viiva 6 min · ei huviveneitä, ei kalastusaluksia · ei törmäyksenestoon', '#c3cedd']]);
      }
      if (this.tasot.jalki && this.jalki.length > 1) rivit.push([['Oma jälki 24 h', '#ff6b61'], ['nyt', '#e9f1f7', 'rgba(255,59,48,1)'],
        ['12 h', '#e9f1f7', 'rgba(255,59,48,' + jalkiAlfa(43200).toFixed(2) + ')'], ['24 h sitten', '#e9f1f7', 'rgba(255,59,48,' + jalkiAlfa(86400).toFixed(2) + ')']]);
      if (this.tasot.lampo && d.phy) rivit.push([['Lämpö (malli) ' + f(this.askel) + ' °C välein', '#ffb24a']]);
      if (this.tasot.sst && d.sst) rivit.push([['Satelliitti: katkoviiva', '#ffffff']]);
      if (this.tasot.virta && d.phy) rivit.push([['Virta: nuoli ≈ 0,9 km/h (0,25 m/s)', '#78ebff']]);
      if (this.tasot.aaltoraja && d.wav) {
        const f2 = x => x.toFixed(2).replace(/0$/, '').replace('.', ',');
        rivit.push([['Merkitsevä aalto', '#e9f1f7'], ['≥' + f2(this.aaltoRajat[0]) + ' m pisteet', '#e9f1f7', '#ffd54a'], ['≥' + f2(this.aaltoRajat[1]) + ' m viivat', '#e9f1f7', '#ff3c3c']]);
      }
      if (this.tasot.aalto && d.wav) rivit.push([['Aalto <', '#ffd54a'], ['0,25', '#e9f1f7', 'rgb(64,140,255)'], ['0,5', '#e9f1f7', 'rgb(60,200,160)'],
        ['0,75', '#e9f1f7', 'rgb(170,220,60)'], ['1', '#e9f1f7', 'rgb(250,210,40)'], ['1,5', '#e9f1f7', 'rgb(255,140,30)'], ['+ m', '#e9f1f7', 'rgb(235,50,40)']]);
      if (!rivit.length) return;
      const g = this.ctx;
      g.save(); g.font = '12px sans-serif';
      const leveys = rivi => rivi.reduce((s, [t, , n]) => s + g.measureText(t).width + (n ? 13 : 0) + 6, 0);
      const lev = Math.max(...rivit.map(leveys)) + 10;
      const kork = rivit.length * 16 + 8, y0 = this.h - this.alaVara - kork - 22;   // vasen alakulma, alapaneelin yläpuolella
      g.fillStyle = 'rgba(5,15,28,0.75)'; g.fillRect(6, y0, lev, kork);
      rivit.forEach((rivi, i) => {
        let x = 12; const y = y0 + 16 + i * 16;
        for (const [t, vari, nelio] of rivi) {
          if (nelio) { g.fillStyle = nelio; g.fillRect(x, y - 9, 10, 10); x += 13; }
          g.fillStyle = vari; g.fillText(t, x, y); x += g.measureText(t).width + 6;
        }
      });
      g.restore();
    }
  }

  const KarttaMalli = { lonX, latY, xLon, yLat, kayra, tasot, arvovali, lahinIndeksi, lahinArvo, lahinAika, virta, akseliArvo,
                        kerros, lohiLuokka, profiiliPisteessa, puraSyvyys, lahinKayra, puraVaylat, lahinVayla, tuuliVari,
                        havainnotPisteessa, havaintoTiedot, havaintoVari, etaisyysViivaan, jasennaSaaliit, aaltoLuokka,
                        jalkiOsat, jalkiAlfa, lahinJalki, ketjuta, matalikot, matalikkoPisteessa, renkaanSisalla };
  if (typeof module !== 'undefined' && module.exports) module.exports = KarttaMalli;
  else { root.KarttaMalli = KarttaMalli; root.Kartta = Kartta; }
})(typeof window !== 'undefined' ? window : this);
