/* Merilohitutka – kartta.js
 * Kevyt oma karttanäkymä (ei ulkoisia kirjastoja): OSM-taustakartta valinnaisena,
 * Copernicus-datasta lämpökäyrät, satelliittilämpö, pintavirtanuolet ja aallonkorkeus.
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
      this.tasot = { lampo: true, sst: false, virta: true, aalto: false, tausta: true };
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
        if (this.tasot.lampo && d.phy) this._kayrat(d.phy, 'lampo', this.aika, false);
        if (this.tasot.sst && d.sst) this._kayrat(d.sst, 'lampo', 0, true);
        if (this.tasot.virta && d.phy) this._virta();
      }
      this._merkit();
      this._selite();
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
      const g = this.ctx, rivit = [];
      if (this.tasot.lampo && this.data && this.data.phy) rivit.push(['Lämpö (malli) käyrät ' + this.askel.toString().replace('.', ',') + ' °C välein', '#ffb24a']);
      if (this.tasot.sst && this.data && this.data.sst) rivit.push(['Satelliittilämpö (katkoviiva)', '#fff']);
      if (this.tasot.virta && this.data && this.data.phy) rivit.push(['Virta: nuoli ≈ 0,25 m/s', '#78ebff']);
      if (this.tasot.aalto && this.data && this.data.wav) {
        rivit.push(['Aalto (m): sininen <0,25 · vihreä <0,75', '#ffd54a']);
        rivit.push(['keltainen <1,0 · oranssi <1,5 · punainen ≥1,5', '#ffd54a']);
      }
      if (!rivit.length) return;
      g.save(); g.font = '12px sans-serif';
      const lev = Math.max(...rivit.map(r => g.measureText(r[0]).width)) + 16;
      const kork = rivit.length * 17 + 8, y0 = this.h - kork - 22; // vasen alakulma, ei peitä zoom-nappeja
      g.fillStyle = 'rgba(5,15,28,0.75)'; g.fillRect(6, y0, lev, kork);
      rivit.forEach(([t, c], i) => { g.fillStyle = c; g.fillText(t, 14, y0 + 16 + i * 17); });
      g.restore();
    }
  }

  const KarttaMalli = { lonX, latY, xLon, yLat, kayra, tasot, arvovali, lahinIndeksi, lahinArvo, lahinAika, virta, akseliArvo };
  if (typeof module !== 'undefined' && module.exports) module.exports = KarttaMalli;
  else { root.KarttaMalli = KarttaMalli; root.Kartta = Kartta; }
})(typeof window !== 'undefined' ? window : this);
