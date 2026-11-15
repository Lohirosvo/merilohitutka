/* Merilohitutka – reitti.js (v30, Hannu 15.11.2026: "Tehdään kaikki mutta merisään muodossa")
 *
 * 1) Reitti satamasta: väylää (Väyläviraston navigointilinjat) pitkin, kunnes väylä saavuttaa syvyyskäyrän
 *    (oletus 10 m, Hannu: "väyliä käytetään 10–20 m vedelle asti"), sitten suoraan. Suora osuus ei saa ylittää
 *    matalia käyriä (≤ 3 m: saaret ja karit); jos kaikki vaihtoehdot ylittävät, valitaan lyhin ja annetaan varoitus.
 * 2) Aallokko reitillä ajan mukaan: suurin ja jyrkin aalto, jyrkän aallokon osuus, vastavirran jyrkentyminen.
 * 3) Merisääteksti (luetaan ääneen).
 * Puhtaat funktiot, testattavissa Nodessa. Aaltofysiikka KarttaMallista (kartta.js).
 */
(function (root) {
  'use strict';
  const K = typeof module !== 'undefined' && module.exports ? require('./kartta.js') : root.KarttaMalli;
  const R = 6371000;

  function etaisyysM(la1, lo1, la2, lo2) {
    const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /** Paikallinen tasoprojektio metreinä (riittää alueen kokoisille etäisyyksille). */
  function projektio(lat0, lon0) {
    const ky = R * Math.PI / 180, kx = ky * Math.cos(lat0 * Math.PI / 180);   // sama pallo kuin etaisyysM (ero ellipsoidiin < 0,5 %)
    return { x: lon => (lon - lon0) * kx, y: lat => (lat - lat0) * ky, lat: y => lat0 + y / ky, lon: x => lon0 + x / kx };
  }
  /** Janojen ab ja cd leikkaus tasossa: f ∈ [0,1] janalla ab tai null. */
  function leikkaus(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const qx = cx - ax, qy = cy - ay, t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  }

  /** Ruudukkoindeksi janoille (solu 500 m): nopea haku janan ympäriltä. */
  function janaIndeksi(viivat, P, solu) {
    solu = solu || 500;
    const solut = new Map(), janat = [];
    for (const v of viivat) {
      const p = v.ll;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = P.x(p[i + 1]), ay = P.y(p[i]), bx = P.x(p[i + 3]), by = P.y(p[i + 2]);
        const n = janat.push([ax, ay, bx, by]) - 1;
        for (let gx = Math.floor(Math.min(ax, bx) / solu); gx <= Math.floor(Math.max(ax, bx) / solu); gx++)
          for (let gy = Math.floor(Math.min(ay, by) / solu); gy <= Math.floor(Math.max(ay, by) / solu); gy++) {
            const k = gx + ',' + gy; if (!solut.has(k)) solut.set(k, []); solut.get(k).push(n);
          }
      }
    }
    return {
      janat,
      /** Janat, jotka voivat leikata janaa (ax,ay)-(bx,by): solut janan varrelta (v32: ei koko rajauslaatikkoa, pitkät suorat). */
      ehdokkaat(ax, ay, bx, by) {
        const nahty = new Set(), solu2 = new Set(), L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / (solu / 2)));
        for (let k = 0; k <= n; k++) {
          const gx = Math.floor((ax + (bx - ax) * k / n) / solu), gy = Math.floor((ay + (by - ay) * k / n) / solu);
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            const avain = (gx + i) + ',' + (gy + j);
            if (solu2.has(avain)) continue; solu2.add(avain);
            for (const m of solut.get(avain) || []) nahty.add(m);
          }
        }
        return nahty;
      }
    };
  }
  /** Leikkaako jana (ax,ay)-(bx,by) jotain indeksin janaa (paitsi aivan alussa, jottei alkupiste lasketa). */
  function leikkaakoJono(ind, ax, ay, bx, by) {
    for (const n of ind.ehdokkaat(ax, ay, bx, by)) {
      const [cx, cy, dx, dy] = ind.janat[n], t = leikkaus(ax, ay, bx, by, cx, cy, dx, dy);
      if (t !== null && t > 1e-6) return true;
    }
    return false;
  }

  /** Ruudukkoindeksi janoille [ax, ay, bx, by, …] (v33): haku janan varrelta tai pisteen ympäriltä. */
  function ruudukko(janat, solu) {
    const solut = new Map();
    janat.forEach((j, n) => {
      const L = Math.hypot(j[2] - j[0], j[3] - j[1]), k = Math.max(1, Math.ceil(L / (solu / 2)));
      const nahty = new Set();
      for (let i = 0; i <= k; i++) {
        const avain = Math.floor((j[0] + (j[2] - j[0]) * i / k) / solu) + ',' + Math.floor((j[1] + (j[3] - j[1]) * i / k) / solu);
        if (nahty.has(avain)) continue; nahty.add(avain);
        if (!solut.has(avain)) solut.set(avain, []); solut.get(avain).push(n);
      }
    });
    return {
      lahella(x, y, sade) {   // janat, joiden jokin solu on ≤ sade + solu pisteestä
        const out = new Set(), r = Math.ceil(sade / solu) + 1, gx = Math.floor(x / solu), gy = Math.floor(y / solu);
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const n of solut.get((gx + i) + ',' + (gy + j)) || []) out.add(n);
        return out;
      },
      varrella(ax, ay, bx, by) {
        const out = new Set(), L = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(L / (solu / 2)));
        for (let i = 0; i <= k; i++) {
          const gx = Math.floor((ax + (bx - ax) * i / k) / solu), gy = Math.floor((ay + (by - ay) * i / k) / solu);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const n of solut.get((gx + a) + ',' + (gy + b)) || []) out.add(n);
        }
        return out;
      }
    };
  }
  /** Pisteen lähin kohta janalla: { f, x, y, m }. */
  function projisoi(j, x, y) {
    const dx = j[2] - j[0], dy = j[3] - j[1], L2 = dx * dx + dy * dy;
    const f = L2 > 0 ? Math.max(0, Math.min(1, ((x - j[0]) * dx + (y - j[1]) * dy) / L2)) : 0;
    const px = j[0] + f * dx, py = j[1] + f * dy;
    return { f, x: px, y: py, m: Math.hypot(px - x, py - y) };
  }

  /**
   * Väyläverkko navigointilinjoista (v33, Hannu 15.11.: Vaasassa reitti meni suoraan, koska satama liitettiin vain linjojen
   * taitepisteisiin): pisteet ≤ sideM yhdistetään; risteävät janat liitetään risteyskohdasta; linjan pää liitetään toisen linjan
   * lähimpään kohtaan (≤ liitosM, myös keskelle janaa). Palauttaa { P, solmut: [[x,y,lat,lon]], naapurit, kaaret, kaariInd }.
   */
  function verkko(vaylat, sideM, liitosM) {
    sideM = sideM || 25; liitosM = liitosM || 120;
    const linjat = ((vaylat && vaylat.linjat) || []).filter(v => v.ll && v.ll.length >= 4);
    if (!linjat.length) return null;
    const P = projektio(linjat[0].ll[0], linjat[0].ll[1]);
    // 1) janat ja niiden jakokohdat
    const janat = [], li = [], jako = [];
    linjat.forEach((v, k) => { const p = v.ll;
      for (let i = 0; i + 3 < p.length; i += 2) { janat.push([P.x(p[i + 1]), P.y(p[i]), P.x(p[i + 3]), P.y(p[i + 2])]); li.push(k); jako.push([]); } });
    const ind = ruudukko(janat, 500);
    // 2) risteykset (ilman yhteistä taitepistettä)
    janat.forEach((a, n) => {
      for (const m of ind.varrella(a[0], a[1], a[2], a[3])) {
        if (m <= n) continue;
        const b = janat[m], f = leikkaus(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]);
        if (f === null) continue;
        const g = leikkaus(b[0], b[1], b[2], b[3], a[0], a[1], a[2], a[3]);
        if (g === null) continue;
        if (f > 1e-6 && f < 1 - 1e-6) jako[n].push(f);
        if (g > 1e-6 && g < 1 - 1e-6) jako[m].push(g);
      }
    });
    // 3) linjan päät toisen linjan lähimpään kohtaan
    const lisaKaaret = [];
    linjat.forEach((v, k) => { const p = v.ll, n = p.length;
      for (const [la, lo] of [[p[0], p[1]], [p[n - 2], p[n - 1]]]) {
        const x = P.x(lo), y = P.y(la); let paras = null;
        for (const m of ind.lahella(x, y, liitosM)) {
          if (li[m] === k) continue;
          const q = projisoi(janat[m], x, y);
          if (q.m <= liitosM && (!paras || q.m < paras.q.m)) paras = { m, q };
        }
        if (!paras || paras.q.m < 1e-6) continue;
        if (paras.q.f > 1e-6 && paras.q.f < 1 - 1e-6) jako[paras.m].push(paras.q.f);
        lisaKaaret.push([x, y, paras.q.x, paras.q.y]);
      }
    });
    // 4) solmut ja kaaret
    const solmut = [], naapurit = [], ruutu = new Map(), kaaret = [];
    const solmu = (x, y) => {
      const gx = Math.floor(x / sideM), gy = Math.floor(y / sideM);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
        for (const n of ruutu.get((gx + i) + ',' + (gy + j)) || []) if (Math.hypot(solmut[n][0] - x, solmut[n][1] - y) <= sideM) return n;
      const n = solmut.push([x, y, P.lat(y), P.lon(x)]) - 1; naapurit.push([]);
      const k = gx + ',' + gy; if (!ruutu.has(k)) ruutu.set(k, []); ruutu.get(k).push(n);
      return n;
    };
    const kaari = (a, b) => {
      if (a === b || naapurit[a].some(e => e.j === b)) return;
      const m = Math.hypot(solmut[a][0] - solmut[b][0], solmut[a][1] - solmut[b][1]);
      naapurit[a].push({ j: b, m }); naapurit[b].push({ j: a, m }); kaaret.push([a, b]);
    };
    janat.forEach((j, n) => {
      const fs = [0].concat(jako[n].sort((a, b) => a - b), [1]);
      let ed = null;
      for (const f of fs) { const s = solmu(j[0] + f * (j[2] - j[0]), j[1] + f * (j[3] - j[1])); if (ed !== null) kaari(ed, s); ed = s; }
    });
    for (const [x1, y1, x2, y2] of lisaKaaret) kaari(solmu(x1, y1), solmu(x2, y2));
    const kaariInd = ruudukko(kaaret.map(([a, b]) => [solmut[a][0], solmut[a][1], solmut[b][0], solmut[b][1]]), 500);
    return { P, solmut, naapurit, kaaret, kaariInd };
  }
  /** Lähin kohta väyläverkossa (myös kaaren keskellä): { a, b, f, x, y, m } tai null (> maxM). */
  function lahinVayla(V, x, y, maxM) {
    let paras = null;
    for (const n of V.kaariInd.lahella(x, y, maxM)) {
      const [a, b] = V.kaaret[n], q = projisoi([V.solmut[a][0], V.solmut[a][1], V.solmut[b][0], V.solmut[b][1]], x, y);
      if (q.m <= maxM && (!paras || q.m < paras.m)) paras = { a, b, f: q.f, x: q.x, y: q.y, m: q.m };
    }
    return paras;
  }

  /** Dijkstra solmusta s: { d, ed } (etäisyys metreinä, edeltäjä). */
  function dijkstra(V, s) {
    const n = V.solmut.length, d = new Float64Array(n).fill(Infinity), ed = new Int32Array(n).fill(-1), valmis = new Uint8Array(n);
    d[s] = 0;
    const keko = [[0, s]];
    const ylos = i => { while (i > 0) { const p = (i - 1) >> 1; if (keko[p][0] <= keko[i][0]) break; [keko[p], keko[i]] = [keko[i], keko[p]]; i = p; } };
    const alas = i => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < keko.length && keko[l][0] < keko[m][0]) m = l; if (r < keko.length && keko[r][0] < keko[m][0]) m = r;
      if (m === i) break; [keko[m], keko[i]] = [keko[i], keko[m]]; i = m; } };
    while (keko.length) {
      const [du, u] = keko[0]; const viim = keko.pop(); if (keko.length) { keko[0] = viim; alas(0); }
      if (valmis[u]) continue; valmis[u] = 1;
      for (const { j, m } of V.naapurit[u]) if (du + m < d[j]) { d[j] = du + m; ed[j] = u; keko.push([d[j], j]); ylos(keko.length - 1); }
    }
    return { d, ed };
  }

  /** Suljettu pieni rengas (v32): alku ja loppu ≤ 50 m toisistaan ja rajauslaatikon lävistäjä < maxM → syvänne, ei avovettä. */
  function pieniRengas(v, P, maxM) {
    const p = v.ll, n = p.length;
    if (!(maxM > 0) || n < 6) return false;
    const auki = Math.hypot(P.x(p[n - 1]) - P.x(p[1]), P.y(p[n - 2]) - P.y(p[0]));
    if (auki > 50) return false;
    return Math.hypot(P.x(v.lo1) - P.x(v.lo0), P.y(v.la1) - P.y(v.la0)) < maxM;
  }
  /** Montako matalan käyrän janaa suora (x,y)→(qx,qy) leikkaa (viimeiset varaM metriä pois). */
  function matalaLaskuri(ind, x, y, qx, qy, varaM) {
    const L = Math.hypot(qx - x, qy - y);
    if (L <= varaM) return 0;
    const f = (L - varaM) / L, bx = x + f * (qx - x), by = y + f * (qy - y);
    let n = 0;
    for (const k of ind.ehdokkaat(x, y, bx, by)) {
      const [cx, cy, dx, dy] = ind.janat[k], t = leikkaus(x, y, bx, by, cx, cy, dx, dy);
      if (t !== null && t > 1e-6) n++;
    }
    return n;
  }
  /** Leikkaako jana (x,y)→(qx,qy) matalia käyriä, kun viimeiset varaM metriä (kohteen ympäristö) jätetään pois. */
  function matalaSuoralla(ind, x, y, qx, qy, varaM) {
    const L = Math.hypot(qx - x, qy - y);
    if (L <= varaM) return false;
    const f = (L - varaM) / L;
    return leikkaakoJono(ind, x, y, x + f * (qx - x), y + f * (qy - y));
  }

  /** Osuus a→b kelpaa (v34), jos se ei leikkaa matalia käyriä; alusta vAlku ja lopusta vLoppu metriä jätetään pois. */
  function osuusKelpaa(ind, ax, ay, bx, by, vAlku, vLoppu) {
    const L = Math.hypot(bx - ax, by - ay);
    if (L <= vAlku + vLoppu) return true;
    const f0 = vAlku / L, f1 = 1 - vLoppu / L;
    return !leikkaakoJono(ind, ax + f0 * (bx - ax), ay + f0 * (by - ay), ax + f1 * (bx - ax), ay + f1 * (by - ay));
  }
  /**
   * Syvän veden haku (v34, Hannu 15.11.: "syvän veden kautta väyliä suosien"): ruudukko-A* lähtöjoukosta (väylän
   * poistumiskohdat kustannuksineen tai turvallisen veden piste) kohteeseen. Ruudut, joihin matala käyrä (≤ matalaRaja) osuu,
   * ovat esteitä; niiden viereiset ruudut maksavat 3 × (pysytään ~ruudun verran irti matalasta). Lopuksi reitti oiotaan:
   * suora osuus kelpaa, jos se ei kulje esteen eikä sen reunuksen kautta. Kohteen ja turvapisteen ympäriltä vara pois esteistä.
   * Palauttaa { alku, ketju: [[x,y]…] välipisteet, g } tai null.
   */
  function syvaHaku(alut, qx, qy, matalaInd, paino, varaM, opts) {
    opts = opts || {};
    if (!alut.length) return null;
    // ruudukko: kohde ja lähtökohdat + reunus, ruutu 150 m … (enintään ~90 000 ruutua)
    let x0 = qx, y0 = qy, x1 = qx, y1 = qy;
    for (const a of alut) { if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x; if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y; }
    const reuna = opts.reunaM || 4000; x0 -= reuna; y0 -= reuna; x1 += reuna; y1 += reuna;
    const solu = Math.max(opts.soluM || 150, Math.sqrt((x1 - x0) * (y1 - y0) / (opts.maxRuudut || 90000)));
    const nx = Math.ceil((x1 - x0) / solu) + 1, ny = Math.ceil((y1 - y0) / solu) + 1, N = nx * ny;
    const ix = x => Math.floor((x - x0) / solu), iy = y => Math.floor((y - y0) / solu);
    const keski = c => [x0 + ((c % nx) + 0.5) * solu, y0 + (Math.floor(c / nx) + 0.5) * solu];
    const este = new Uint8Array(N), reunus = new Uint8Array(N);
    for (const [ax, ay, bx, by] of matalaInd.janat) {   // matalat käyrät ruuduiksi (näyte ⅓ ruudun välein)
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (solu / 3)));
      for (let t = 0; t <= k; t++) { const i = ix(ax + (bx - ax) * t / k), j = iy(ay + (by - ay) * t / k);
        if (i >= 0 && i < nx && j >= 0 && j < ny) este[j * nx + i] = 1; }
    }
    for (let c = 0; c < N; c++) if (este[c]) { const i = c % nx, j = Math.floor(c / nx);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = i + a, jj = j + b; if (ii >= 0 && ii < nx && jj >= 0 && jj < ny) reunus[jj * nx + ii] = 1; } }
    const vapauta = (x, y, r) => { const R = Math.ceil(r / solu) + 1;
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) { const ii = ix(x) + a, jj = iy(y) + b;
        if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
        const [cx, cy] = keski(jj * nx + ii); if (Math.hypot(cx - x, cy - y) <= r + solu * 0.75) { este[jj * nx + ii] = 0; reunus[jj * nx + ii] = 0; } } };
    vapauta(qx, qy, varaM);
    for (const a of alut) if (a.vara) vapauta(a.x, a.y, a.vara);
    const T = iy(qy) * nx + ix(qx);
    // A*: 8-suuntaa, viisto ei kahden esteen välistä
    const g = new Float64Array(N).fill(Infinity), ed = new Int32Array(N).fill(-1), lahde = new Int32Array(N).fill(-1), kiinni = new Uint8Array(N);
    const h = c => { const [cx, cy] = keski(c); return paino * Math.hypot(qx - cx, qy - cy); };
    const keko = [];
    const lisaa = (f, n) => { keko.push([f, n]); let i = keko.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (keko[p][0] <= keko[i][0]) break; [keko[p], keko[i]] = [keko[i], keko[p]]; i = p; } };
    const ota = () => { const top = keko[0], viim = keko.pop();
      if (keko.length) { keko[0] = viim; let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < keko.length && keko[l][0] < keko[m][0]) m = l; if (r < keko.length && keko[r][0] < keko[m][0]) m = r;
          if (m === i) break; [keko[m], keko[i]] = [keko[i], keko[m]]; i = m; } }
      return top; };
    alut.forEach((a, k) => {
      const i = ix(a.x), j = iy(a.y); if (i < 0 || i >= nx || j < 0 || j >= ny) return;
      const c = j * nx + i; if (este[c]) return;
      const [cx, cy] = keski(c), g0 = a.g + paino * Math.hypot(cx - a.x, cy - a.y);
      if (g0 < g[c]) { g[c] = g0; lahde[c] = k; lisaa(g0 + h(c), c); }
    });
    const ASKEL = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let loyty = false;
    while (keko.length) {
      const [, c] = ota(); if (kiinni[c]) continue; kiinni[c] = 1;
      if (c === T) { loyty = true; break; }
      const i = c % nx, j = Math.floor(c / nx);
      for (const [a, b, k] of ASKEL) {
        const ii = i + a, jj = j + b; if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
        const n = jj * nx + ii; if (este[n] || kiinni[n]) continue;
        if (a && b && este[j * nx + ii] && este[jj * nx + i]) continue;
        const gn = g[c] + paino * solu * k * (reunus[n] ? 3 : 1);
        if (gn < g[n]) { g[n] = gn; ed[n] = c; lahde[n] = lahde[c]; lisaa(gn + h(n), n); }
      }
    }
    if (!loyty) return null;
    const solut = []; for (let c = T; c >= 0; c = ed[c]) solut.push(c);
    solut.reverse();
    const alku = lahde[T], A = alut[alku];
    const pts = [[A.x, A.y]].concat(solut.slice(1, -1).map(keski), [[qx, qy]]);
    // oiominen: ruutuja pitkin näkyvyys (ei estettä, reunusta vain päiden lähellä) + tarkka käyrätarkistus
    const nakyy = (p, q, vAlku, vLoppu) => {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]), k = Math.max(1, Math.ceil(L / (solu / 3)));
      for (let t = 0; t <= k; t++) { const x = p[0] + (q[0] - p[0]) * t / k, y = p[1] + (q[1] - p[1]) * t / k, i = ix(x), j = iy(y);
        if (i < 0 || i >= nx || j < 0 || j >= ny) return false;
        const c = j * nx + i, dp = L * t / k;
        if (este[c] || (reunus[c] && dp > 1.5 * solu && L - dp > 1.5 * solu)) return false; }
      return osuusKelpaa(matalaInd, p[0], p[1], q[0], q[1], vAlku, vLoppu);
    };
    const ketju = []; let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      for (let k = pts.length - 1; k > i + 1; k--) if (nakyy(pts[i], pts[k], i === 0 ? (A.vara || 1) : 1, k === pts.length - 1 ? varaM : 1)) { j = k; break; }
      if (j < pts.length - 1) ketju.push(pts[j]);
      i = j;
    }
    return { alku, ketju, g: g[T] };
  }

  /**
   * Reitti satamasta kohteeseen (v32 väyläpainotteinen, v34 syvän veden kautta).
   * o = { satama:{lat,lon}, kohde:{lat,lon}, vaylat (puraVaylat), syvyys (puraSyvyys), rajaSyvyys (10),
   *       matalaRaja (6: osuudet eivät ylitä tämän syvyisiä tai matalampia käyriä; viimeiset 300 m kohteen ympärillä sallitaan),
   *       suoraPaino (1,5: vapaa osuus painaa näin monta kertaa väylämatkan verran), pieniSyvanneM (1000),
   *       turva (true: piste on jo turvallisessa vedessä → ei saaristoväyliä, suoraan tai syvän veden kautta),
   *       verkko (valmis verkko(), valinnainen), liityntaM (3000) }
   * Luiska: väylää rajasyvyyden käyrän yli (ei pientä suljettua syvännettä), sitten syvän veden kautta: osuudet kohteeseen ja
   * rajakäyrän välipisteiden (500 m välein) kautta, halvin = väylämatka + paino × vapaat osuudet.
   * Palauttaa { pisteet, m, vaylaM, suoraM, tapa: 'vayla'|'suora'|'turva', poistuminen, kayra, syvaan, kierto, varoitus }.
   */
  function reitti(o) {
    const S = o.satama, Q = o.kohde, raja = isFinite(o.rajaSyvyys) ? o.rajaSyvyys : 10, matala = isFinite(o.matalaRaja) ? o.matalaRaja : 6;
    const paino = isFinite(o.suoraPaino) && o.suoraPaino >= 1 ? o.suoraPaino : 1.5, pieniM = isFinite(o.pieniSyvanneM) ? o.pieniSyvanneM : 1000, varaM = 300;
    const tasot = o.syvyys && o.syvyys.tasot ? o.syvyys.tasot : [];
    const suoraan = (varoitus) => {   // v33: varareitti kertoo myös, jos suora viiva ylittää saaren, karin tai maan (≤ 3 m käyrä)
      const r = suora(S, Q, o.syvyys, 3);
      return Object.assign(r, { tapa: 'suora', syvaan: false, kierto: 0, varoitus: r.varoitus ? varoitus + '; ' + r.varoitus.replace('suora reitti ylittää', 'se ylittää') : varoitus });
    };
    const V = o.turva ? null : (o.verkko || verkko(o.vaylat));
    if (!o.turva && (!V || !V.solmut.length)) return suoraan('väyläaineistoa ei ole: reitti suoraan satamasta');
    const P = V ? V.P : projektio(S.lat, S.lon), sx = P.x(S.lon), sy = P.y(S.lat), qx = P.x(Q.lon), qy = P.y(Q.lat);
    // rajakäyrä (pienet suljetut syvänteet pois), matalat esteet ja syvän veden välipisteet
    const tasoLista = tasot.map(t => t.syvyys).filter(x => x >= raja - 1e-9).sort((a, b) => a - b);
    const kayra = tasoLista.length ? tasoLista[0] : null;
    const kayraViivat = kayra === null ? [] : tasot.find(t => t.syvyys === kayra).viivat.filter(v => !pieniRengas(v, P, pieniM));
    const kayraInd = janaIndeksi(kayraViivat, P);
    const matalaInd = janaIndeksi([].concat(...tasot.filter(t => t.syvyys <= matala + 1e-9).map(t => t.viivat)), P);
    const xy = (x, y) => [P.lat(y), P.lon(x)];
    const pituus = (pts) => { let m = 0; for (let i = 1; i < pts.length; i++) m += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return m; };

    if (o.turva) {   // turvallisen veden pisteestä: suoraan tai syvän veden kautta, ei saaristoväyliä
      const hk = osuusKelpaa(matalaInd, sx, sy, qx, qy, varaM, varaM) ? { ketju: [] }   // suora kelpaa: lyhin mahdollinen
        : syvaHaku([{ x: sx, y: sy, g: 0, vara: varaM }], qx, qy, matalaInd, paino, varaM);
      if (!hk) { const r = suora(S, Q, o.syvyys, matala); return Object.assign(r, { kierto: 0, syvaan: true }); }
      const vapaa = [[sx, sy]].concat(hk.ketju, [[qx, qy]]), m = pituus(vapaa);
      return { pisteet: vapaa.map(([x, y]) => xy(x, y)), m, vaylaM: 0, suoraM: m, tapa: 'turva', poistuminen: null, kayra, syvaan: true, kierto: hk.ketju.length, varoitus: null };
    }

    // v33: satama väylän lähimpään kohtaan (myös pitkän janan keskelle); väliaikainen solmu poistetaan lopuksi
    const lk = (V.kaariInd ? lahinVayla(V, sx, sy, isFinite(o.liityntaM) ? o.liityntaM : 3000) : null);
    if (!lk) return suoraan('satama yli 3 km väylästä: reitti suoraan');
    const alku = V.solmut.length, am = lk.m, L = Math.hypot(V.solmut[lk.b][0] - V.solmut[lk.a][0], V.solmut[lk.b][1] - V.solmut[lk.a][1]);
    V.solmut.push([lk.x, lk.y, P.lat(lk.y), P.lon(lk.x)]); V.naapurit.push([{ j: lk.a, m: lk.f * L }, { j: lk.b, m: (1 - lk.f) * L }]);
    V.naapurit[lk.a].push({ j: alku, m: lk.f * L }); V.naapurit[lk.b].push({ j: alku, m: (1 - lk.f) * L });
    // v36 (Hannu 15.11.: "Väyliä pitkin pitäisi päästä paikasta toiseen jos väylään klikkaa"): kohde enintään vaylallaM
    // väylästä → kohteen kohta väylällä väliaikaiseksi solmuksi ja reitti väylää pitkin perille
    const vaylallaM = isFinite(o.vaylallaM) ? o.vaylallaM : 200;
    const lq = vaylallaM > 0 ? lahinVayla(V, qx, qy, vaylallaM) : null;
    let ks = -1, samaKaari = false;
    if (lq) {
      ks = V.solmut.length;
      const Lq = Math.hypot(V.solmut[lq.b][0] - V.solmut[lq.a][0], V.solmut[lq.b][1] - V.solmut[lq.a][1]);
      V.solmut.push([lq.x, lq.y, P.lat(lq.y), P.lon(lq.x)]);
      const nq = [{ j: lq.a, m: lq.f * Lq }, { j: lq.b, m: (1 - lq.f) * Lq }];
      samaKaari = (lq.a === lk.a && lq.b === lk.b) || (lq.a === lk.b && lq.b === lk.a);
      if (samaKaari) {   // satama ja kohde samalla janalla: suora yhteys janaa pitkin
        const fs = lq.a === lk.a ? lk.f : 1 - lk.f, m = Math.abs(fs - lq.f) * Lq;
        nq.push({ j: alku, m }); V.naapurit[alku].push({ j: ks, m });
      }
      V.naapurit.push(nq); V.naapurit[lq.a].push({ j: ks, m: lq.f * Lq }); V.naapurit[lq.b].push({ j: ks, m: (1 - lq.f) * Lq });
    }
    try { return reittiVerkossa(); }
    finally {
      if (lq) { V.naapurit[lq.b].pop(); V.naapurit[lq.a].pop(); V.naapurit.pop(); if (samaKaari) V.naapurit[alku].pop(); V.solmut.pop(); }
      V.naapurit[lk.a].pop(); V.naapurit[lk.b].pop(); V.naapurit.pop(); V.solmut.pop();
    }
    function reittiVerkossa() {
    const { d, ed } = dijkstra(V, alku);
    if (ks >= 0 && isFinite(d[ks])) {   // v36: kohde väylällä
      const polku = []; for (let n = ks; n >= 0; n = ed[n]) polku.push(n);
      polku.reverse();
      const vaylaM = am + d[ks];
      return { pisteet: [[S.lat, S.lon]].concat(polku.map(n => [V.solmut[n][2], V.solmut[n][3]]), [[Q.lat, Q.lon]]), m: vaylaM + lq.m, vaylaM, suoraM: lq.m,
               tapa: 'vayla', vaylalla: true, poistuminen: { lat: P.lat(lq.y), lon: P.lon(lq.x) }, kayra, syvaan: false, kierto: 0, varoitus: null };
    }
    // väyläpuu etäisyysjärjestyksessä: syva = polku satamasta on ylittänyt poistumiskäyrän
    const jarj = []; for (let i = 0; i < V.solmut.length; i++) if (isFinite(d[i])) jarj.push(i);
    jarj.sort((a, b) => d[a] - d[b]);
    const syva = new Uint8Array(V.solmut.length), ehd = [];
    // v36: jos satama → väylä -liitos ylittää poistumiskäyrän, väylä on käyrän takana alusta asti (ennen ylitys jäi huomaamatta
    // ja reitti haki käyrän ylityksen kauempaa, Hannun Eckerön kuva 15.11.: "näyttää väkisin käyvän 10 m vedessä")
    { const [x1, y1] = V.solmut[alku];
      for (const n of kayraInd.ehdokkaat(sx, sy, x1, y1)) { const [cx, cy, dx, dy] = kayraInd.janat[n];
        if (leikkaus(sx, sy, x1, y1, cx, cy, dx, dy) !== null) { syva[alku] = 1; ehd.push({ x: x1, y: y1, kautta: alku, pitkin: 0, solmu: true }); break; } } }
    for (const b of jarj) {
      const a = ed[b]; if (a < 0) continue;
      const [ax, ay] = V.solmut[a], [bx, by] = V.solmut[b], len = d[b] - d[a];
      let fMin = null;
      for (const n of kayraInd.ehdokkaat(ax, ay, bx, by)) {
        const [cx, cy, dx, dy] = kayraInd.janat[n], f = leikkaus(ax, ay, bx, by, cx, cy, dx, dy);
        if (f !== null && (fMin === null || f < fMin)) fMin = f;
      }
      if (fMin !== null && !syva[a]) ehd.push({ x: ax + fMin * (bx - ax), y: ay + fMin * (by - ay), kautta: a, pitkin: d[a] + fMin * len });
      syva[b] = syva[a] || fMin !== null ? 1 : 0;
      if (syva[b]) ehd.push({ x: bx, y: by, kautta: b, pitkin: d[b], solmu: true });
    }
    const hinnoittele = e => { e.suora = Math.hypot(qx - e.x, qy - e.y); e.hinta = e.pitkin + paino * e.suora; return e; };
    let lista = ehd.map(hinnoittele).sort((a, b) => a.hinta - b.hinta), varoitus = null, syvaan = true;
    if (!lista.length) {   // väylä ei ylitä käyrää: väylää kohteen suuntaan niin pitkälle kuin kannattaa
      syvaan = false;
      lista = jarj.map(b => hinnoittele({ x: V.solmut[b][0], y: V.solmut[b][1], kautta: b, pitkin: d[b], solmu: true })).sort((a, b) => a.hinta - b.hinta);
      varoitus = kayra === null ? `${luku0(raja)} m:n syvyyskäyrää ei ole` : `väylältä ei löydy ${luku0(kayra)} m:n käyrän ylitystä`;
    }
    // v34: syvän veden haku kaikista poistumiskohdista; kohteeseen suoraan tai välipisteiden kautta
    // halvin poistuminen, jonka suora osuus kelpaa; jos se on kaikista halvin, kiertoa ei tarvitse etsiä (suora = alaraja)
    let suoraParas = null;
    for (const e of lista.slice(0, 300)) if (!matalaSuoralla(matalaInd, e.x, e.y, qx, qy, varaM)) { suoraParas = e; break; }
    const hk = suoraParas === lista[0] ? null : syvaHaku(lista.map(e => ({ x: e.x, y: e.y, g: e.pitkin })), qx, qy, matalaInd, paino, varaM);
    const kiertoHinta = hk ? lista[hk.alku].pitkin + paino * pituus([[lista[hk.alku].x, lista[hk.alku].y]].concat(hk.ketju, [[qx, qy]])) : Infinity;
    let valittu, ketju = [];
    if (suoraParas && suoraParas.hinta <= kiertoHinta) valittu = suoraParas;
    else if (hk) { valittu = lista[hk.alku]; ketju = hk.ketju; }
    else {   // v33: mikään ei kelpaa → 300 halvimmasta se, jonka suora ylittää vähiten matalia käyriä
      let paras = null;
      for (const e of lista.slice(0, 300)) { e.matalia = matalaLaskuri(matalaInd, e.x, e.y, qx, qy, varaM);
        if (!paras || e.matalia < paras.matalia || (e.matalia === paras.matalia && e.hinta < paras.hinta)) paras = e; }
      valittu = paras || lista[0];
      const v2 = `suora osuus ylittää ${luku0(matala)} m:n tai matalamman käyrän`;
      varoitus = varoitus ? varoitus + ', ' + v2 : v2;
    }
    // polku: satama → väyläpolku → poistumispiste → välipisteet → kohde
    const polku = []; for (let n = valittu.kautta; n >= 0; n = ed[n]) polku.push(n);
    polku.reverse();
    const vapaa = [[valittu.x, valittu.y]].concat(ketju, [[qx, qy]]), suoraM = pituus(vapaa);
    const pisteet = [[S.lat, S.lon]].concat(polku.map(n => [V.solmut[n][2], V.solmut[n][3]]),
      valittu.solmu ? [] : [xy(valittu.x, valittu.y)], ketju.map(([x, y]) => xy(x, y)), [[Q.lat, Q.lon]]);
    const vaylaM = am + valittu.pitkin;
    return { pisteet, m: vaylaM + suoraM, vaylaM, suoraM, tapa: 'vayla',
             poistuminen: { lat: P.lat(valittu.y), lon: P.lon(valittu.x) }, kayra, syvaan, kierto: ketju.length, varoitus };
    }
  }
  /** v31: suora reitti turvallisen veden pisteestä (Luoto): ei väylää; varoitus, jos ylittää matalan käyrän (≤ matalaRaja). */
  function suora(piste, kohde, syvyys, matalaRaja) {
    const matala = isFinite(matalaRaja) ? matalaRaja : 3, m = etaisyysM(piste.lat, piste.lon, kohde.lat, kohde.lon);
    const out = { pisteet: [[piste.lat, piste.lon], [kohde.lat, kohde.lon]], m, vaylaM: 0, suoraM: m, tapa: 'turva', poistuminen: null, kayra: null, varoitus: null };
    const tasot = syvyys && syvyys.tasot ? syvyys.tasot.filter(t => t.syvyys <= matala + 1e-9) : [];
    if (tasot.length) {
      const P = projektio(piste.lat, piste.lon), ind = janaIndeksi([].concat(...tasot.map(t => t.viivat)), P);
      if (leikkaakoJono(ind, 0, 0, P.x(kohde.lon), P.y(kohde.lat))) out.varoitus = `suora reitti ylittää ${luku0(matala)} m:n tai matalamman käyrän (saari tai kari)`;
    }
    return out;
  }
  function luku0(x) { return String(Math.round(x * 10) / 10).replace('.', ','); }

  /** Näytteet murtoviivalta enintään valiM välein: [{ lat, lon, m }] (m = matka alusta). */
  function naytteet(pisteet, valiM) {
    valiM = valiM || 500;
    const out = []; let m = 0;
    for (let i = 0; i < pisteet.length; i++) {
      if (i === 0) { out.push({ lat: pisteet[0][0], lon: pisteet[0][1], m: 0 }); continue; }
      const [la1, lo1] = pisteet[i - 1], [la2, lo2] = pisteet[i], L = etaisyysM(la1, lo1, la2, lo2);
      const n = Math.max(1, Math.ceil(L / valiM));
      for (let k = 1; k <= n; k++) { const f = k / n; out.push({ lat: la1 + f * (la2 - la1), lon: lo1 + f * (lo2 - lo1), m: m + f * L }); }
      m += L;
    }
    return out;
  }
  function kaanna(pisteet) { return pisteet.slice().reverse(); }

  /**
   * Vastavirran jyrkentymiskerroin (syvä vesi, aalto tyynestä vedestä virtaan; Longuet-Higgins & Stewart).
   * Tp s, uVasta = vastakkainen virtakomponentti m/s (> 0 vastaan). Palauttaa jyrkkyyden kertoimen (1 = ei vaikutusta).
   */
  function vastavirtaKerroin(Tp, uVasta) {
    if (!(Tp > 0) || !(uVasta > 0)) return 1;
    const c0 = 9.81 * Tp / (2 * Math.PI), u = -uVasta, juuri = 1 + 4 * u / c0;
    if (juuri <= 0) return 3;   // aalto estyy: merkitään suureksi
    const c = 0.5 * c0 * (1 + Math.sqrt(juuri)), sisa = c * (c + 2 * u);
    if (sisa <= 0) return 3;
    return Math.min(3, (c0 / Math.sqrt(sisa)) * (c0 / c) ** 2);
  }
  /** Vastakkainen komponentti: aallon tulosuunta (° mistä), virta u,v (m/s, itä/pohjoinen). > 0 = virta aaltoa vastaan. */
  function vastaKomponentti(aaltoMista, u, v) {
    if (!isFinite(aaltoMista) || !isFinite(u) || !isFinite(v)) return NaN;
    const kohti = (aaltoMista + 180) * Math.PI / 180, ex = Math.sin(kohti), ey = Math.cos(kohti);
    return -(u * ex + v * ey);
  }

  /**
   * Aallokko reitillä. nayt = naytteet(), lahtoMs, nopeusKmh,
   * hae(lat, lon, ms) → { hs, T (Tm-1,0), tp (huippujakso), tpArvio, suunta (° mistä), u, v (m/s), pohja (m tai NaN) } | null,
   * r = { hs: jyrkän alaraja m, s: jyrkkyysraja osuutena, vvKerroin: 1.15, vvHs: 0.25 }.
   * Jyrkkyys kuten kartalla: Hs / L(Tm-1,0); pohjasyvyyden kanssa L lyhenee (matala vesi). Vastavirta huippujaksosta.
   * Palauttaa { n, puuttuu, puuttuuM, maxHs, jyrkin, jyrkkaM, jyrkkiaPisteita, vastavirta, matala }.
   */
  function aallokkoReitilla(nayt, lahtoMs, nopeusKmh, hae, r) {
    const v = Math.max(1, nopeusKmh) / 3.6;
    const out = { n: 0, puuttuu: 0, puuttuuM: 0, maxHs: null, jyrkin: null, jyrkkaM: 0, vastavirta: null, jyrkkiaPisteita: 0, matala: null };
    let edM = 0, edJyrkka = false;
    for (const p of nayt) {
      const t = lahtoMs + p.m / v * 1000, a = hae(p.lat, p.lon, t);
      const askel = p.m - edM; edM = p.m;
      if (!a || !isFinite(a.hs)) { out.puuttuu++; out.puuttuuM += askel; edJyrkka = false; continue; }
      out.n++;
      const L0 = K.aallonPituus(a.T), L = K.aallonPituus(a.T, a.pohja), s = isFinite(L) && L > 0 ? a.hs / L : NaN;
      const jyrkka = isFinite(s) && a.hs >= r.hs - 1e-9 && s >= r.s - 1e-12;
      const piste = { lat: p.lat, lon: p.lon, m: p.m, t, hs: a.hs, T: a.T, tp: a.tp, tpArvio: !!a.tpArvio, L, s, jyrkka, pohja: a.pohja };
      if (!out.maxHs || a.hs > out.maxHs.hs) out.maxHs = piste;
      if (isFinite(s) && a.hs >= r.hs - 1e-9 && (!out.jyrkin || s > out.jyrkin.s)) out.jyrkin = piste;
      if (jyrkka) { out.jyrkkiaPisteita++; if (edJyrkka) out.jyrkkaM += askel; }
      edJyrkka = jyrkka;
      // matala vesi: syvyys alle puolen aallonpituuden ja jyrkkyys kasvaa ≥ 10 % (vain, kun aalto on vähintään jyrkän alaraja)
      if (isFinite(a.pohja) && L0 > 0 && L < L0 / 1.1 && a.hs >= r.hs - 1e-9 && (!out.matala || L0 / L > out.matala.kerroin))
        out.matala = Object.assign({}, piste, { kerroin: L0 / L });
      const Tp = isFinite(a.tp) && a.tp > 0 ? a.tp : a.T * 1.107;
      const uv = vastaKomponentti(a.suunta, a.u, a.v), k = vastavirtaKerroin(Tp, uv);
      if (a.hs >= (r.vvHs || 0.25) && k >= (r.vvKerroin || 1.15) && (!out.vastavirta || k > out.vastavirta.kerroin))
        out.vastavirta = Object.assign({}, piste, { kerroin: k, virta: uv });
    }
    return out;
  }
  /** Trendi kahdesta aallokkoReitilla-tuloksesta: 'kasvaa' | 'laskee' | 'pysyy' | null. */
  function trendi(nyt, myoh) {
    if (!nyt || !myoh || !nyt.maxHs || !myoh.maxHs) return null;
    const dh = myoh.maxHs.hs - nyt.maxHs.hs, ds = (myoh.jyrkin ? myoh.jyrkin.s : 0) - (nyt.jyrkin ? nyt.jyrkin.s : 0);
    if (dh >= 0.1 || (dh >= 0.05 && ds >= 0.005)) return 'kasvaa';
    if (dh <= -0.1 || (dh <= -0.05 && ds <= -0.005)) return 'laskee';
    return 'pysyy';
  }

  // ------------------------------------------------------------ merisääteksti (luetaan ääneen)
  const SUUNNAT = ['pohjoisesta', 'koillisesta', 'idästä', 'kaakosta', 'etelästä', 'lounaasta', 'lännestä', 'luoteesta'];
  const l1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '');
  const l2 = x => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
  const kello = d => { const h = d.getHours(), m = d.getMinutes(); return 'kello ' + h + (m ? '.' + String(m).padStart(2, '0') : ''); };
  const km = m => (m < 1000 ? Math.round(m / 100) * 100 + ' metriä' : l1(m / 1000) + ' kilometriä');
  function tuuliLause(tu) {
    if (!tu || !isFinite(tu.ws)) return null;
    const suunta = isFinite(tu.wd) ? SUUNNAT[Math.round(tu.wd / 45) % 8] + ' ' : '';
    return `${suunta}${Math.round(tu.ws)}${isFinite(tu.wg) ? ', puuskissa ' + Math.round(tu.wg) : ''} metriä sekunnissa`;
  }
  /** Kohdan kuvaus: paluulla matka ennen satamaa, menolla matka satamasta; lähin nimetty merkki ≤ 1,5 km (nimeä ei taivuteta). */
  function paikka(p, d) {
    const loppuun = Math.max(0, (d.reitti ? d.reitti.m : 0) - p.m);
    const osa = d.tyyppi === 'meno' ? (loppuun < 300 ? 'kohteessa' : `${km(p.m)} lähtöpisteestä`) : (p.m < 300 ? 'lähtöpaikalla' : `${km(loppuun)} ennen paluupistettä`);
    let lahin = null, ld = 1500;
    for (const m of d.merkit || []) { const e = etaisyysM(p.lat, p.lon, m.lat, m.lon); if (e < ld) { ld = e; lahin = m; } }
    return lahin ? `${osa}, kohdassa ${lahin.nimi}` : osa;
  }
  /**
   * Merisää tekstinä. d = { klo: Date, tyyppi: 'paluu'|'meno', alue, kohdeNimi, reitti: {m, vaylaM, suoraM, tapa, kayra, varoitus},
   *   minuutit, nopeus, tuuliNyt, tuuli2h {ws,wg,wd}, raja {ws,wg}, ylitys: {t, syy}|null, lahtoViimeistaan: Date|null,
   *   aallot (aallokkoReitilla), aallot2h, rajat {hs, s}, oma {pinta, lohi}, merkit, mista }
   */
  function merisaaTeksti(d) {
    const L = [];
    const meno = d.tyyppi === 'meno';
    L.push(`Merisää ${kello(d.klo)}. ${d.alue ? d.alue + '.' : ''}`.trim());
    const tn = tuuliLause(d.tuuliNyt), t2 = tuuliLause(d.tuuli2h);
    if (tn) L.push(`Tuuli ${tn}.` + (t2 ? ` Kahden tunnin päästä ${t2}.` : ''));
    else L.push('Tuuliennustetta ei ole.');
    if (d.ylitys && d.ylitys.t) L.push(`Tuuliraja ylittyy ${d.ylitys.t <= d.klo ? 'nyt' : kello(d.ylitys.t)}${d.ylitys.syy ? ', ' + d.ylitys.syy : ''}.`);
    if (!meno && d.lahtoViimeistaan) L.push(`Lähde paluulle viimeistään ${kello(d.lahtoViimeistaan)}.`);
    if (!meno && d.kova) L.push(d.kova === 'suoja' ? 'Kova tuuli: paluu lähimpään suojaan.' : 'Kova tuuli: paluu lähimmän turvallisen veden pisteen kautta.');
    const r = d.reitti;
    if (!r) L.push(meno ? 'Menoreittiä ei voitu laskea.' : 'Paluureittiä ei voitu laskea: sijaintia tai paluukohdetta ei ole.');
    else {
      const minne = meno ? `Menomatka ${d.lahtoMista ? d.lahtoMista + ' ' : ''}kohteeseen` : `Paluu ${d.kohdeNimiIllatiivi || 'satamaan'}`;
      L.push(`${minne} ${km(r.m)}` + (r.kautta ? `, ${r.kautta}` : '') + (r.tapa === 'vayla' ? (r.vaylalla ? ', väylää pitkin' : `, josta väylää ${km(r.vaylaM)}${r.syvaan !== false && r.kayra ? ` ${luku0(r.kayra)} metrin veteen` : ''}`) : '') +
        (r.kierto ? ', matalikot kiertäen syvän veden kautta' : '') +
        (isFinite(d.minuutit) ? `, noin ${Math.round(d.minuutit)} minuuttia ${Math.round(d.nopeus)} kilometrin tuntinopeudella.` : '.'));
      if (!meno && d.jatko) L.push(`Sieltä ${d.jatko.minne} ${km(d.jatko.m)}.`);
      if (r.varoitus) L.push(`Huomio: ${r.varoitus}.`);
    }
    const a = d.aallot;
    if (a && a.maxHs) {
      const reitilla = meno ? 'Menoreitillä' : 'Paluureitillä';
      L.push(`${reitilla} merkitsevä aalto enintään ${l2(a.maxHs.hs)} metriä, ${paikka(a.maxHs, d)}.`);
      if (a.jyrkin && a.jyrkin.jyrkka) {
        L.push(`Jyrkkää aallokkoa ${a.jyrkkaM >= 500 ? 'noin ' + km(a.jyrkkaM) + ' matkalla' : 'paikoin'}. Jyrkin kohta ${paikka(a.jyrkin, d)}: ` +
          `${l2(a.jyrkin.hs)} metriä, jakso ${l1(a.jyrkin.T)} sekuntia, jyrkkyys ${l1(a.jyrkin.s * 100)} prosenttia.`);
      } else L.push(`Ei jyrkkää aallokkoa${a.jyrkin ? ', jyrkin ' + l1(a.jyrkin.s * 100) + ' prosenttia' : ''}.`);
      // Aaltomalli (WAM) on ajettu pintavirtojen kanssa: luvut sisältävät virran. Lause kertoo syyn ja paikan.
      if (a.vastavirta) L.push(`Virta käy aaltoja vastaan ${paikka(a.vastavirta, d)}: jyrkentää aallokkoa noin ${Math.round((a.vastavirta.kerroin - 1) * 100)} prosenttia, luvut sisältävät tämän.`);
      if (a.matala) L.push(`Matala vesi jyrkentää aallokkoa ${paikka(a.matala, d)}, noin ${Math.round((a.matala.kerroin - 1) * 100)} prosenttia.`);
      if (a.puuttuuM >= 1000) L.push(`Aaltomalli ei kata noin ${km(a.puuttuuM)} reitistä: rannan ja saarten lähellä mallin ruutu on noin kaksi kilometriä.`);
    } else if (r) L.push('Aaltoennustetta reitille ei ole.');
    const tr = trendi(d.aallot, d.aallot2h);
    if (tr === 'kasvaa') L.push(`Aallokko kasvaa kahden tunnin aikana: enintään ${l2(d.aallot2h.maxHs.hs)} metriä${d.aallot2h.jyrkin && d.aallot2h.jyrkin.jyrkka ? ', jyrkkää' : ''}.`);
    else if (tr === 'laskee') L.push(`Aallokko laskee kahden tunnin aikana: enintään ${l2(d.aallot2h.maxHs.hs)} metriä.`);
    else if (tr === 'pysyy') L.push('Aallokko pysyy kahden tunnin ajan ennallaan.');
    if (d.oma) {
      const o = [];
      if (isFinite(d.oma.pinta)) o.push(`pintavesi ${l1(d.oma.pinta)} astetta`);
      if (d.oma.lohi) o.push(d.oma.lohi);
      if (o.length) L.push((meno ? 'Kohteessa ' : 'Täällä ') + o.join(', ') + '.');
    }
    return L.join(' ').replace(/, (lähtöpaikalla|kohteessa)/g, ' $1');
  }

  /** Ääneen luettava muoto: kellonajat ja välit selkeämmiksi puhesyntetisaattorille. */
  function puheeksi(teksti) {
    return teksti.replace(/kello (\d{1,2})\.(\d\d)/g, 'kello $1 $2').replace(/(\d)\s*–\s*(\d)/g, '$1 – $2');
  }

  const Reitti = { etaisyysM, projektio, leikkaus, verkko, lahinVayla, dijkstra, reitti, suora, naytteet, kaanna, vastavirtaKerroin, vastaKomponentti,
                   aallokkoReitilla, trendi, merisaaTeksti, puheeksi };
  if (typeof module !== 'undefined' && module.exports) module.exports = Reitti;
  else root.Reitti = Reitti;
})(typeof window !== 'undefined' ? window : this);
