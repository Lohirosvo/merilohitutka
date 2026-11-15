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
      /** Janat, jotka voivat leikata janaa (ax,ay)-(bx,by). */
      ehdokkaat(ax, ay, bx, by) {
        const nahty = new Set();
        for (let gx = Math.floor(Math.min(ax, bx) / solu); gx <= Math.floor(Math.max(ax, bx) / solu); gx++)
          for (let gy = Math.floor(Math.min(ay, by) / solu); gy <= Math.floor(Math.max(ay, by) / solu); gy++)
            for (const n of solut.get(gx + ',' + gy) || []) nahty.add(n);
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

  /**
   * Väyläverkko navigointilinjoista: solmut (yhdistetty, jos ≤ sideM), kaaret peräkkäisten pisteiden välillä,
   * linjan päät liitetään lähimpään toisen linjan solmuun (≤ liitosM). Palauttaa { P, solmut: [[x,y,lat,lon]], naapurit }.
   */
  function verkko(vaylat, sideM, liitosM) {
    sideM = sideM || 25; liitosM = liitosM || 120;
    const linjat = (vaylat && vaylat.linjat) || [];
    if (!linjat.length) return null;
    const P = projektio(linjat[0].ll[0], linjat[0].ll[1]);
    const solmut = [], naapurit = [], ruutu = new Map(), linja = [];
    const avain = (x, y) => Math.floor(x / sideM) + ',' + Math.floor(y / sideM);
    const solmu = (lat, lon, li) => {
      const x = P.x(lon), y = P.y(lat), gx = Math.floor(x / sideM), gy = Math.floor(y / sideM);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
        for (const n of ruutu.get((gx + i) + ',' + (gy + j)) || []) if (Math.hypot(solmut[n][0] - x, solmut[n][1] - y) <= sideM) return n;
      const n = solmut.push([x, y, lat, lon]) - 1; naapurit.push([]); linja.push(li);
      const k = avain(x, y); if (!ruutu.has(k)) ruutu.set(k, []); ruutu.get(k).push(n);
      return n;
    };
    const kaari = (a, b) => {
      if (a === b || naapurit[a].some(e => e.j === b)) return;
      const m = Math.hypot(solmut[a][0] - solmut[b][0], solmut[a][1] - solmut[b][1]);
      naapurit[a].push({ j: b, m }); naapurit[b].push({ j: a, m });
    };
    const paat = [];
    linjat.forEach((v, li) => {
      const p = v.ll; let ed = null;
      for (let i = 0; i + 1 < p.length; i += 2) { const n = solmu(p[i], p[i + 1], li); if (ed !== null) kaari(ed, n); ed = n; if (i === 0) paat.push(n); }
      if (ed !== null) paat.push(ed);
    });
    for (const n of paat) {   // T-liitokset: linjan pää toisen linjan solmuun
      if (naapurit[n].length > 1) continue;
      const [x, y] = solmut[n]; let paras = -1, pm = liitosM;
      solmut.forEach((s, j) => { if (j === n || linja[j] === linja[n]) return; const d = Math.hypot(s[0] - x, s[1] - y); if (d < pm) { pm = d; paras = j; } });
      if (paras >= 0) kaari(n, paras);
    }
    return { P, solmut, naapurit };
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

  /**
   * Reitti satamasta kohteeseen.
   * o = { satama:{lat,lon}, kohde:{lat,lon}, vaylat (puraVaylat), syvyys (puraSyvyys), rajaSyvyys (10), matalaRaja (3),
   *       verkko (valmis verkko(), valinnainen), liityntaM (3000) }
   * Palauttaa { pisteet: [[lat,lon]…] satamasta kohteeseen, m, vaylaM, suoraM, tapa: 'vayla'|'suora', poistuminen, kayra, varoitus }.
   */
  function reitti(o) {
    const S = o.satama, Q = o.kohde, raja = isFinite(o.rajaSyvyys) ? o.rajaSyvyys : 10, matala = isFinite(o.matalaRaja) ? o.matalaRaja : 3;
    const tasot = o.syvyys && o.syvyys.tasot ? o.syvyys.tasot : [];
    const suoraan = (varoitus) => ({ pisteet: [[S.lat, S.lon], [Q.lat, Q.lon]], m: etaisyysM(S.lat, S.lon, Q.lat, Q.lon), vaylaM: 0,
      suoraM: etaisyysM(S.lat, S.lon, Q.lat, Q.lon), tapa: 'suora', poistuminen: null, kayra: null, varoitus });
    const V = o.verkko || verkko(o.vaylat);
    if (!V || !V.solmut.length) return suoraan('väyläaineistoa ei ole: reitti suoraan satamasta');
    const P = V.P, sx = P.x(S.lon), sy = P.y(S.lat), qx = P.x(Q.lon), qy = P.y(Q.lat);
    // satama lähimpään väyläsolmuun
    let alku = -1, am = isFinite(o.liityntaM) ? o.liityntaM : 3000;
    V.solmut.forEach((s, i) => { const d = Math.hypot(s[0] - sx, s[1] - sy); if (d < am) { am = d; alku = i; } });
    if (alku < 0) return suoraan('satama yli 3 km väylästä: reitti suoraan');
    // poistumiskäyrä: pienin syvyystaso ≥ raja
    const tasoLista = tasot.map(t => t.syvyys).filter(x => x >= raja - 1e-9).sort((a, b) => a - b);
    const kayra = tasoLista.length ? tasoLista[0] : null;
    if (kayra === null) return suoraan(`${raja} m:n syvyyskäyrää ei ole: reitti suoraan satamasta`);
    const kayraInd = janaIndeksi(tasot.find(t => t.syvyys === kayra).viivat, P);
    const matalaInd = janaIndeksi([].concat(...tasot.filter(t => t.syvyys <= matala + 1e-9).map(t => t.viivat)), P);
    const { d, ed } = dijkstra(V, alku);
    // ehdokkaat: väyläkaarten ja poistumiskäyrän leikkauspisteet
    const ehd = [];
    V.naapurit.forEach((ns, a) => ns.forEach(({ j: b, m: len }) => {
      if (b < a || !isFinite(d[a]) || !isFinite(d[b])) return;
      const [ax, ay] = V.solmut[a], [bx, by] = V.solmut[b];
      for (const n of kayraInd.ehdokkaat(ax, ay, bx, by)) {
        const [cx, cy, dx, dy] = kayraInd.janat[n], f = leikkaus(ax, ay, bx, by, cx, cy, dx, dy);
        if (f === null) continue;
        const kautta = d[a] + f * len <= d[b] + (1 - f) * len ? a : b, pitkin = Math.min(d[a] + f * len, d[b] + (1 - f) * len);
        const x = ax + f * (bx - ax), y = ay + f * (by - ay);
        ehd.push({ x, y, kautta, pitkin, suora: Math.hypot(qx - x, qy - y) });
      }
    }));
    if (!ehd.length) return suoraan(`väylä ei saavuta ${luku0(kayra)} m:n käyrää: reitti suoraan satamasta`);
    ehd.forEach(e => { e.yht = e.pitkin + e.suora; });
    ehd.sort((a, b) => a.yht - b.yht);
    let valittu = ehd.find(e => !leikkaakoJono(matalaInd, e.x, e.y, qx, qy)), varoitus = null;
    if (!valittu) { valittu = ehd[0]; varoitus = `suora osuus ylittää ${luku0(matala)} m:n tai matalamman käyrän (saari tai kari)`; }
    // polku: satama → väyläpolku → poistumispiste → kohde
    const polku = []; for (let n = valittu.kautta; n >= 0; n = ed[n]) polku.push(n);
    polku.reverse();
    const pisteet = [[S.lat, S.lon]].concat(polku.map(n => [V.solmut[n][2], V.solmut[n][3]]),
      [[P.lat(valittu.y), P.lon(valittu.x)], [Q.lat, Q.lon]]);
    const liitos = am, vaylaM = liitos + valittu.pitkin;
    return { pisteet, m: vaylaM + valittu.suora, vaylaM, suoraM: valittu.suora, tapa: 'vayla',
             poistuminen: { lat: P.lat(valittu.y), lon: P.lon(valittu.x) }, kayra, varoitus };
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
    if (!meno && d.kova) L.push('Kova tuuli: paluu lähimmän turvallisen veden pisteen kautta.');
    const r = d.reitti;
    if (!r) L.push(meno ? 'Menoreittiä ei voitu laskea.' : 'Paluureittiä ei voitu laskea: sijaintia tai paluukohdetta ei ole.');
    else {
      const minne = meno ? `Menomatka ${d.lahtoMista ? d.lahtoMista + ' ' : ''}kohteeseen` : `Paluu ${d.kohdeNimiIllatiivi || 'satamaan'}`;
      L.push(`${minne} ${km(r.m)}` + (r.kautta ? `, ${r.kautta}` : '') + (r.tapa === 'vayla' ? `, josta väylää ${km(r.vaylaM)} ${luku0(r.kayra)} metrin käyrälle` : '') +
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

  const Reitti = { etaisyysM, projektio, leikkaus, verkko, dijkstra, reitti, suora, naytteet, kaanna, vastavirtaKerroin, vastaKomponentti,
                   aallokkoReitilla, trendi, merisaaTeksti, puheeksi };
  if (typeof module !== 'undefined' && module.exports) module.exports = Reitti;
  else root.Reitti = Reitti;
})(typeof window !== 'undefined' ? window : this);
