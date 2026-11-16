/* Merilohitutka – silakka.js (v49, 16.11.2026; v43 ensimmäinen)
 * Silakan valokerros (tietopohja merilohitutka_silakkakerros_tiedot_v006.md, kohta 1.1), ensin Luoto–Tankar.
 * Hannu 16.11.: "Nyt tehdään ja en heitä noppaa. Luotan claudeen" → valinnat alla, perustelut tilannekuvassa v066.
 *
 * MALLI: valo syvyydellä z: E(z) = E0 · e^(−Kd·z) → z(E) = ln(E0/E) / Kd                                  [tietopohja K]
 *   kala: ylä = z(10 lx), optimi = z(1 lx), ala = z(0,1 lx); rajattuna pohjaan (pohjan tuntuma 0–3 m)     [tietopohja A, L6]
 *   pinnan valo alle 0,1 lx → valo ei rajoita: hajallaan pintakerroksessa                                  [tietopohja A]
 * PINNAN VALO E0 (kirkas taivas):
 *   aurinko ≥ 6°: Haurwitz GHI = 1098·cos z·e^(−0,057/cos z) W/m² [L: Haurwitz 1945] × 110 lm/W [A] (≈ 86 000 lx, kun aurinko 50°)
 *   0…6°: log-interpolointi 400 lx (0°) → Haurwitz(6°) ≈ 7 300 lx [A]
 *   hämärä: 0° 400, −6° 3,4, −12° 0,008, −18° 0,001 lx, log-interpolointi [tietopohja L15 + A]
 *   pilvet (v44): × (1 − 0,75·n^3,4), n = kokonaispilvisyys 0–1 [L: Kasten & Czeplak 1980, Solar Energy 24: 177–189;
 *   keskimääräinen riippuvuus, yksittäinen paksu pilvipeite voi himmentää enemmän]. Täysin pilvinen = × 0,25.
 *   v43:ssa pilvinen oli × 0,125 (tietopohjan 10 000 / 80 000 lx) [A] → nyt kerros noin ln 2 / Kd ≈ 2 m syvemmällä [K].
 *   Hämärässä sama kerroin [A]. Pilvisyys IL:n toimitetusta ennusteesta (hae_tuuli.hae_pilvi). Kuu ja valosaaste puuttuvat.
 * Kd(PAR): 1) Copernicus BGC kd (hetkiarvo klo 12 UTC). Aallonpituutta ei kerrota; mallia on verrattu satelliitin KD490:een
 *   → käsitellään 490 nm:n arvona: Kd(PAR) = 0,6677 · Kd(490)^0,6763 [L: Pierson, Kratzer, Strömbeck, Håkansson 2008,
 *   Remote Sensing of Environment 112: 668–680, Itämeri; ei tietopohjassa, joka käyttää /1,48 (L18)]. Että mallin kd ≈ Kd(490) = A.
 *   2) Copernicus zsd: Kd(PAR) = 1,7 / Secchi (Poole–Atkins) [tietopohja L17]. 3) alueen oletus (Luoto 0,36) [tietopohja K].
 *   QUID: malli olettaa havaintoja pienemmän sameuden → Kd todennäköisesti liian pieni → kerros liian syvällä (rannikolla) [L+A].
 * VAIHE (v49, tietopohja kohta 3.1 Luoto–Tankar, työoletuksia): pohjan lämmöstä (Copernicus bottomT)
 *   alle 8 °C ja pinta yli 3 °C = kutua odottava; 8–14 °C = kutu; yli 14 °C = syönnös; pinta enintään 3 °C = talvehtiminen.
 *   "Kutu ohi" -ehtoa ei ole (vaatisi lämpöhistorian) [A]. Päivällä: odottava pohjan tuntumassa; kutu viereisissä 10–20 m:n
 *   syvänteissä; syönnös harppauskerroksen (mlotst) alla tai pohjassa [tietopohja A]. Yöllä valon mukaan, kudulla kutumatalikolla.
 *   Pohjan syvyyden sopivuus vaiheelle (min / opt / max): odottava 5 / 10–20 / 30, kutu 0,5 / 3–10 / 15, syönnös 10 / 15–30 / 40+.
 * AURINGON KORKEUS: tähtitieteellisen almanakan likiarvo (tarkkuus noin 0,01°), ei taittumista (kuten tietopohjan taulukko).
 */
(function (root) {
  'use strict';
  const RAD = Math.PI / 180;
  const HAMARA = [[-18, 0.001], [-12, 0.008], [-6, 3.4], [0, 400]];
  const TEHO = 110;          // lm/W, päivänvalon valotehokkuus [A]
  const pilviKerroin = n => 1 - 0.75 * Math.pow(Math.min(1, Math.max(0, n)), 3.4);   // n 0–1 [L Kasten & Czeplak 1980]
  const RAJAT = { yla: 10, opt: 1, ala: 0.1 };   // lx [tietopohja A, L6]
  const POHJAN_TUNTUMA = 3;  // m [tietopohja kohta 2]

  /** Auringon korkeus asteina (lat, lon asteina, t Date). */
  function aurinko(lat, lon, t) {
    const n = t.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const L = 280.460 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * RAD;
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, eps = (23.439 - 0.0000004 * n) * RAD;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const gmst = 18.697374558 + 24.06570982441908 * n;   // tuntia
    const ha = (gmst * 15 + lon) * RAD - ra;
    return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
  }

  function haurwitz(h) { const c = Math.sin(h * RAD); return c > 0 ? 1098 * c * Math.exp(-0.057 / c) : 0; }   // W/m²
  const logVali = (x, x0, y0, x1, y1) => Math.exp(Math.log(y0) + (x - x0) / (x1 - x0) * (Math.log(y1) - Math.log(y0)));

  /** Pinnan valaistus (lx) auringon korkeudella h (°). pilvi: kokonaispilvisyys % (0–100), true = 100, puuttuu = kirkas. */
  function pintavalo(h, pilvi) {
    let E;
    if (!isFinite(h)) return NaN;
    if (h <= HAMARA[0][0]) E = HAMARA[0][1];
    else if (h < 0) { let i = 0; while (h > HAMARA[i + 1][0]) i++; E = logVali(h, HAMARA[i][0], HAMARA[i][1], HAMARA[i + 1][0], HAMARA[i + 1][1]); }
    else if (h < 6) E = logVali(h, 0, 400, 6, TEHO * haurwitz(6));
    else E = TEHO * haurwitz(h);
    const n = pilvi === true ? 1 : isFinite(pilvi) && pilvi !== null ? pilvi / 100 : 0;
    return E * pilviKerroin(n);
  }

  /** Kd(PAR) (m⁻¹) ja lähde: { kd, lahde: 'kd'|'zsd'|'oletus', raaka }. */
  function kdPar(kd490, zsd, oletus) {
    if (isFinite(kd490) && kd490 > 0) return { kd: 0.6677 * Math.pow(kd490, 0.6763), lahde: 'kd', raaka: kd490 };
    if (isFinite(zsd) && zsd > 0) return { kd: 1.7 / zsd, lahde: 'zsd', raaka: zsd };
    return isFinite(oletus) && oletus > 0 ? { kd: oletus, lahde: 'oletus', raaka: oletus } : null;
  }

  /** Valokerros: { tila: 'valo'|'pohja'|'hajallaan', yla, opt, ala } metreinä; pohja (m) rajaa, jos tiedossa. */
  function valokerros(E0, Kd, pohja, rajat) {
    rajat = rajat || RAJAT;
    if (!(E0 > 0) || !(Kd > 0)) return null;
    if (E0 < rajat.ala) return { tila: 'hajallaan', yla: 0, opt: NaN, ala: isFinite(pohja) ? pohja : NaN };
    const z = E => Math.max(0, Math.log(E0 / E) / Kd);
    let yla = z(rajat.yla), opt = z(rajat.opt), ala = z(rajat.ala), tila = 'valo';
    if (isFinite(pohja) && pohja > 0) {
      if (opt >= pohja) { tila = 'pohja'; opt = Math.max(0, pohja - POHJAN_TUNTUMA / 2); }
      if (ala > pohja) ala = pohja;
      if (tila === 'pohja' || yla > pohja - POHJAN_TUNTUMA) yla = Math.min(yla, Math.max(0, pohja - POHJAN_TUNTUMA));
    }
    return { tila, yla, opt, ala };
  }

  /** Vuorokauden vaihe auringosta (tietopohja kohta 2): päivä > 5°, yö < −6°, muuten ilta (laskeva) tai aamu (nouseva). */
  function vaihe(lat, lon, t) {
    const h = aurinko(lat, lon, t), h2 = aurinko(lat, lon, new Date(t.getTime() + 20 * 60000));
    return h > 5 ? 'päivä' : h < -6 ? 'yö' : h2 < h ? 'ilta' : 'aamu';
  }

  /** Koko arvio pisteessä: { h, vaihe, kd, kirkas, pilvinen, E0, E0p, pohja } + ennuste ja pilvi, jos o.pilvi (%) annettu. */
  function arvio(o) {
    const h = aurinko(o.lat, o.lon, o.t), kd = kdPar(o.kd490, o.zsd, o.oletusKd);
    if (!kd) return null;
    const E0 = pintavalo(h, false), E0p = pintavalo(h, true);
    const tulos = { h, vaihe: vaihe(o.lat, o.lon, o.t), kd, E0, E0p, pohja: o.pohja,
             kirkas: valokerros(E0, kd.kd, o.pohja), pilvinen: valokerros(E0p, kd.kd, o.pohja) };
    if (isFinite(o.pilvi) && o.pilvi !== null) {
      tulos.pilvi = o.pilvi; tulos.E0e = pintavalo(h, o.pilvi); tulos.ennuste = valokerros(tulos.E0e, kd.kd, o.pohja);
    }
    return tulos;
  }

  // ---------- v49: vaihemalli (tietopohja v006 kohta 3.1, Luoto–Tankar) ----------
  const VAIHEET = {
    odottava: { nimi: 'kutua odottava', pohja: [5, 10, 20, 30] },        // [A]
    kutu: { nimi: 'kutu', pohja: [0.5, 3, 10, 15] },                     // [L2; opt L1]
    syonnos: { nimi: 'syönnös', pohja: [10, 15, 30, Infinity] },         // [A]
    talvi: { nimi: 'talvehtiminen', pohja: null },
  };
  const KUTU_ALA = 8, KUTU_YLA = 14, NOUSU_PINTA = 3;   // °C [L1, L2, L4; nousu K]
  /** Vaiheen tunnus pohjan lämmöstä pt ja pinnan lämmöstä (°C): 'odottava' | 'kutu' | 'syonnos' | 'talvi' | null. */
  function vaiheLampo(pt, pinta) {
    if (!isFinite(pt) || pt === null) return null;
    if (pt > KUTU_YLA) return 'syonnos';
    if (pt >= KUTU_ALA) return 'kutu';
    if (isFinite(pinta) && pinta !== null && pinta <= NOUSU_PINTA) return 'talvi';
    return 'odottava';
  }
  /** Pohjan syvyys z vaiheen välille r = [min, optMin, optMax, max]: 'optimi' | 'sopiva' | 'ei' | null. */
  function sopivuus(z, r) {
    if (!r || !isFinite(z) || z === null) return null;
    return z >= r[1] && z <= r[2] ? 'optimi' : z >= r[0] && z <= r[3] ? 'sopiva' : 'ei';
  }
  /** Vaiheen kerros (v49). o = { pt, pinta, mld, pohja, vrk (vaihe()), valo (valokerros) }.
   *  Palauttaa { tunnus, nimi, ohje, kerros (tila/yla/opt/ala tai null = ei tässä), paikka, raja } tai null. */
  function vaiheMalli(o) {
    const tunnus = vaiheLampo(o.pt, o.pinta);
    if (!tunnus) return null;
    const V = VAIHEET[tunnus], P = isFinite(o.pohja) && o.pohja > 0, valo = o.valo || null, vrk = o.vrk;
    const tuntuma = () => P ? { tila: 'pohja', yla: Math.max(0, o.pohja - POHJAN_TUNTUMA), opt: Math.max(0, o.pohja - POHJAN_TUNTUMA / 2), ala: o.pohja } : null;
    const t = { tunnus, nimi: V.nimi, paikka: P ? sopivuus(o.pohja, V.pohja) : null, raja: V.pohja };
    if (tunnus === 'talvi') return Object.assign(t, { ohje: 'avomeren syvänteissä, ei rannikon mallia', kerros: null });
    if (vrk === 'päivä') {
      if (tunnus === 'odottava') return Object.assign(t, { ohje: 'pohjan tuntumassa', kerros: tuntuma() || valo });
      if (tunnus === 'kutu') {
        if (P && o.pohja >= 10 && o.pohja <= 20) return Object.assign(t, { ohje: 'viereisissä 10–20 m:n syvänteissä: tässä pohjan tuntumassa', kerros: tuntuma() });
        return Object.assign(t, { ohje: 'viereisissä 10–20 m:n syvänteissä' + (P ? `, ei tässä (pohja ${o.pohja < 10 ? 'alle 10' : 'yli 20'} m)` : ''), kerros: null });
      }
      // syönnös: harppauskerroksen alla tai pohjassa
      const M = isFinite(o.mld) && o.mld !== null;
      if (!M || (P && o.mld >= o.pohja - 0.5)) return Object.assign(t, { ohje: 'harppauskerrosta ei ole (sekoittunut pohjaan asti): valon mukaan', kerros: valo });
      if (!valo || valo.tila === 'hajallaan') return Object.assign(t, { ohje: 'valon mukaan', kerros: valo });
      const yla = Math.max(valo.yla, o.mld);
      if (P && yla >= o.pohja - POHJAN_TUNTUMA) return Object.assign(t, { ohje: 'harppauskerroksen alla = pohjan tuntumassa', kerros: tuntuma() });
      // valokerros ulottuu harppauskerroksen alle → sen alaraja; muuten (valo loppuu ennen) harppauskerroksesta pohjaan [A]
      const ala = valo.ala > yla ? valo.ala : (P ? o.pohja : yla + POHJAN_TUNTUMA), alaP = P ? Math.min(ala, o.pohja) : ala;
      return Object.assign(t, { ohje: 'harppauskerroksen alla', kerros: { tila: 'valo', yla, opt: Math.min(Math.max(valo.opt, yla), alaP), ala: alaP } });
    }
    if (vrk === 'yö' && tunnus === 'kutu') {
      if (P && o.pohja <= V.pohja[3]) return Object.assign(t, { ohje: 'kutumatalikolla', kerros: valo });
      return Object.assign(t, { ohje: 'kutumatalikoilla (pohja 0,5–15 m)' + (P ? ', ei tässä' : ''), kerros: null });
    }
    return Object.assign(t, { ohje: 'valon mukaan', kerros: valo });
  }
  /** Onko päivä t (Date) kaudella k = ['KK-PP', 'KK-PP'] (Suomen aikaa likimain: UTC + 2 h). */
  function kaudella(t, k) {
    if (!k || k.length !== 2) return true;
    const d = new Date(t.getTime() + 2 * 3600000), x = String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    return x >= k[0] && x <= k[1];
  }

  const Silakka = { RAJAT, VAIHEET, aurinko, haurwitz, pintavalo, pilviKerroin, kdPar, valokerros, vaihe, arvio,
                    vaiheLampo, sopivuus, vaiheMalli, kaudella };
  if (typeof module !== 'undefined' && module.exports) module.exports = Silakka;
  else root.Silakka = Silakka;
})(typeof window !== 'undefined' ? window : this);
