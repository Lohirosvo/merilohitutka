/* Merilohitutka – kartta.js
 * Kevyt oma karttanäkymä (ei ulkoisia kirjastoja): OSM-taustakartta valinnaisena,
 * Copernicus-datasta lämpökäyrät, lohikerros (lämpövälin syvyys), satelliittilämpö, pintavirtanuolet
 * ja aallonkorkeus. Traficomin merikartan syvyyskäyrät (v8; ei navigointikäyttöön).
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
      this.tasot = { lampo: true, lohi: true, syvyys: true, sst: false, virta: true, aalto: false, tausta: true };
      this.syvyys = null;   // puraSyvyys()-tulos
      this.merkit = opts.merkit || []; this.oma = null; this.valittu = null;
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
      if (this.tasot.tausta) this._tausta();
      const d = this.data;
      if (d) {
        if (this.tasot.aalto && d.wav) this._aalto();
        if (this.tasot.lohi && d.phy && d.phy.profiili) this._lohi();
      }
      if (d) {
        if (this.tasot.lampo && d.phy) this._kayrat(d.phy, 'lampo', this.aika, false);
        if (this.tasot.sst && d.sst) this._kayrat(d.sst, 'lampo', 0, true);
      }
      if (this.tasot.syvyys && this.syvyys) this._syvyys();   // lämpökäyrien päälle: 20 m ja 6 m erottuvat
      if (d && this.tasot.virta && d.phy) this._virta();
      this._merkit();
      this._profiiliAlue = null;
      const profiili = d && this.tasot.lohi && this.valittu ? this._profiili() : false;
      if (!profiili) this._selite();   // selite ja profiili eivät mahdu päällekkäin
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
          let px = m[0] * s - ox, py = m[1] * s - oy, kuljettu = 120;   // numero n. 240 px välein viivaa pitkin
          g.moveTo(px, py);
          for (let k = 2; k < m.length; k += 2) {
            const x = m[k] * s - ox, y = m[k + 1] * s - oy;
            g.lineTo(x, y);
            kuljettu += Math.hypot(x - px, y - py); px = x; py = y;
            if (kuljettu >= 240 && x > 20 && x < this.w - 70 && y > 24 && y < this.h - 24) { ehdokkaat.push([taso.syvyys, x, y, vari]); kuljettu = 0; }
          }
        }
        g.stroke();
      }
      // numerot: tärkeät ensin, ei päällekkäin
      g.globalAlpha = 1; g.font = 'bold 11px sans-serif';
      const varattu = new Set(), tarkeys = d => d === 20 ? 0 : d === 6 ? 1 : 2;
      ehdokkaat.sort((a, b) => tarkeys(a[0]) - tarkeys(b[0]));
      let nimetty = 0;
      for (const [d, x, y, vari] of ehdokkaat) {
        if (nimetty >= 45) break;
        if (tarkeys(d) === 2 && this.z < 11) continue;
        const ruutu = Math.floor(x / 70) + ',' + Math.floor(y / 34);
        if (varattu.has(ruutu)) continue;
        varattu.add(ruutu); nimetty++;
        const txt = String(d).replace('.', ',');
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(txt, x + 2, y - 2);
        g.fillStyle = vari; g.fillText(txt, x + 2, y - 2);
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
      const g = this.ctx, X = 8, Y = 8, W = 132, H = 156;
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
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '11px sans-serif';
      g.fillText('© OpenStreetMap', 6, this.h - 6);
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
        let nimiKohta = null;
        for (const [la1, lo1, la2, lo2] of janat) {
          const [x1, y1] = this.ruutu(la1, lo1), [x2, y2] = this.ruutu(la2, lo2);
          g.moveTo(x1, y1); g.lineTo(x2, y2);
          if (paa && !nimiKohta && x1 > 30 && x1 < this.w - 30 && y1 > 30 && y1 < this.h - 60) nimiKohta = [x1, y1];
        }
        g.stroke();
        if (nimiKohta) {
          const txt = taso.toFixed(1).replace('.', ',');
          g.setLineDash([]); g.font = 'bold 13px sans-serif';
          g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(txt, nimiKohta[0] + 3, nimiKohta[1] - 3);
          g.fillStyle = katko ? '#fff' : lampoVari(taso, min, max); g.fillText(txt, nimiKohta[0] + 3, nimiKohta[1] - 3);
          g.setLineDash(katko ? [6, 4] : []);
        }
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
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(m.nimi, x + 9, y + 4);
        g.fillStyle = '#fff'; g.fillText(m.nimi, x + 9, y + 4);
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

    _selite() {
      // Tiivis selite: rivi = osia [teksti, tekstin väri, neliön väri]
      const d = this.data || {}, rivit = [];
      const f = x => x.toString().replace('.', ',');
      if (this.tasot.lohi && d.phy && d.phy.profiili) rivit.push([['Lohikerros alkaa', '#7ed957'],
        ['0–3', '#e9f1f7', 'rgb(60,220,120)'], ['3–6', '#e9f1f7', 'rgb(240,210,60)'], ['6–12 m', '#e9f1f7', 'rgb(255,140,40)'], ['ei', '#e9f1f7', 'rgb(110,120,130)']]);
      if (this.tasot.syvyys && this.syvyys) rivit.push([['Syvyys (Traficom)', '#c3cedd'], ['20 m', '#e9f1f7', '#ff5ad6'], ['6 m', '#e9f1f7', '#e3ebff'], ['muut', '#e9f1f7', '#8793a3']]);
      if (this.tasot.lampo && d.phy) rivit.push([['Lämpö (malli) ' + f(this.askel) + ' °C välein', '#ffb24a']]);
      if (this.tasot.sst && d.sst) rivit.push([['Satelliitti: katkoviiva', '#ffffff']]);
      if (this.tasot.virta && d.phy) rivit.push([['Virta: nuoli ≈ 0,25 m/s', '#78ebff']]);
      if (this.tasot.aalto && d.wav) rivit.push([['Aalto <', '#ffd54a'], ['0,25', '#e9f1f7', 'rgb(64,140,255)'], ['0,5', '#e9f1f7', 'rgb(60,200,160)'],
        ['0,75', '#e9f1f7', 'rgb(170,220,60)'], ['1', '#e9f1f7', 'rgb(250,210,40)'], ['1,5', '#e9f1f7', 'rgb(255,140,30)'], ['+ m', '#e9f1f7', 'rgb(235,50,40)']]);
      if (!rivit.length) return;
      const g = this.ctx;
      g.save(); g.font = '12px sans-serif';
      const leveys = rivi => rivi.reduce((s, [t, , n]) => s + g.measureText(t).width + (n ? 13 : 0) + 6, 0);
      const lev = Math.max(...rivit.map(leveys)) + 10;
      const kork = rivit.length * 16 + 8, y0 = this.h - kork - 20;   // vasen alakulma, ei peitä zoom-nappeja
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
                        kerros, lohiLuokka, profiiliPisteessa, puraSyvyys, lahinKayra };
  if (typeof module !== 'undefined' && module.exports) module.exports = KarttaMalli;
  else { root.KarttaMalli = KarttaMalli; root.Kartta = Kartta; }
})(typeof window !== 'undefined' ? window : this);
