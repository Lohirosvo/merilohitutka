/* Merilohitutka – nopeus.js
 * GPS-nopeuden tasaus ja nopeushälytyksen päätös (Hanaa / Himmaa). Puhtaat funktiot.
 * Nopeus on maan suhteen (GPS). Nopeus veden suhteen tulee myöhemmin Copernicuksen pintavirrasta.
 */
(function (root) {
  'use strict';

  const OLETUKSET = {
    nopeusMin: 4.0,      // km/h, Hannun tyypillinen uistelunopeus 4–6 km/h (säädettävä)
    nopeusMax: 6.0,
    tasausS: 15,         // s, liukuva keskiarvo (sama kuin uistelututkan tasaus)
    halytysViiveS: 8,    // s, nopeuden pitää olla rajan ulkopuolella näin kauan ennen ääntä
    toistoS: 30,         // s, sama ääni toistuu aikaisintaan näin usein
    pysahdysKmh: 1.5     // km/h, tätä hitaammin ei hälytetä (kalan väsytys, pysähdys)
  };

  function rad(d) { return d * Math.PI / 180; }
  function etaisyysM(a, b) {
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Tasattu nopeus km/h viimeisen tasausS sekunnin pisteistä.
   * pisteet: [{t: ms, lat, lon, speed: m/s|null}] aikajärjestyksessä.
   * Ensisijaisesti laitteen ilmoittama nopeus (keskiarvo), muuten kuljettu matka / aika.
   */
  function tasattuNopeus(pisteet, nytMs, tasausS) {
    const alku = nytMs - tasausS * 1000;
    const ikkuna = pisteet.filter(p => p.t >= alku && p.t <= nytMs);
    if (!ikkuna.length) return NaN;
    const laitteen = ikkuna.filter(p => p.speed != null && isFinite(p.speed) && p.speed >= 0);
    if (laitteen.length >= Math.max(1, ikkuna.length / 2)) {
      return laitteen.reduce((s, p) => s + p.speed, 0) / laitteen.length * 3.6;
    }
    if (ikkuna.length < 2) return NaN;
    let m = 0;
    for (let i = 1; i < ikkuna.length; i++) m += etaisyysM(ikkuna[i - 1], ikkuna[i]);
    const s = (ikkuna[ikkuna.length - 1].t - ikkuna[0].t) / 1000;
    return s > 0 ? m / s * 3.6 : NaN;
  }

  /** Suunta (°) kahden viimeisen riittävän kaukana olevan pisteen välillä, tai laitteen heading. */
  function suunta(pisteet) {
    const v = pisteet[pisteet.length - 1];
    if (!v) return NaN;
    if (v.heading != null && isFinite(v.heading)) return v.heading;
    for (let i = pisteet.length - 2; i >= 0; i--) {
      const a = pisteet[i];
      if (etaisyysM(a, v) >= 10) {
        const y = Math.sin(rad(v.lon - a.lon)) * Math.cos(rad(v.lat));
        const x = Math.cos(rad(a.lat)) * Math.sin(rad(v.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(v.lat)) * Math.cos(rad(v.lon - a.lon));
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      }
    }
    return NaN;
  }

  /**
   * Hälytyksen päätös. tila = {ulkonaAlkaen: ms|null, suunta: 'hidas'|'nopea'|null, viimeksiPuhuttu: ms|null}
   * Palauttaa {tila (uusi), luokka: 'ok'|'hidas'|'nopea'|'pysahdys'|'ei', puhu: 'Hanaa'|'Himmaa'|null}
   */
  function halytys(kmh, nytMs, tila, asetukset) {
    const a = Object.assign({}, OLETUKSET, asetukset || {});
    const t = Object.assign({ ulkonaAlkaen: null, suunta: null, viimeksiPuhuttu: null }, tila || {});
    if (!isFinite(kmh)) return { tila: { ...t, ulkonaAlkaen: null, suunta: null }, luokka: 'ei', puhu: null };
    if (kmh < a.pysahdysKmh) return { tila: { ...t, ulkonaAlkaen: null, suunta: null }, luokka: 'pysahdys', puhu: null };
    let luokka = 'ok';
    if (kmh < a.nopeusMin) luokka = 'hidas';
    else if (kmh > a.nopeusMax) luokka = 'nopea';
    if (luokka === 'ok') return { tila: { ...t, ulkonaAlkaen: null, suunta: null }, luokka, puhu: null };

    if (t.suunta !== luokka) { t.suunta = luokka; t.ulkonaAlkaen = nytMs; t.viimeksiPuhuttu = null; }
    let puhu = null;
    const kesto = (nytMs - t.ulkonaAlkaen) / 1000;
    const toistoOk = t.viimeksiPuhuttu == null || (nytMs - t.viimeksiPuhuttu) / 1000 >= a.toistoS;
    if (kesto >= a.halytysViiveS && toistoOk) {
      puhu = luokka === 'hidas' ? 'Hanaa' : 'Himmaa';
      t.viimeksiPuhuttu = nytMs;
    }
    return { tila: t, luokka, puhu };
  }

  /**
   * Nopeus veden suhteen (v18, Hannu 13.11.): maanopeusvektori (GPS: km/h ja kulkusuunta astetta) miinus pintavirta
   * (Copernicus u = itään, v = pohjoiseen, m/s). Palauttaa { kmh, vastaan, virtaKmh }:
   *   kmh = nopeus veden suhteen (km/h), vastaan = virran komponentti kulkusuuntaa vastaan (km/h, + = vastavirta,
   *   – = myötävirta), virtaKmh = virran nopeus (km/h). Alle 0,5 km/h kulkusuunta ei ole luotettava -> kmh NaN.
   */
  function vedenSuhteen(kmh, suuntaAst, u, v) {
    const tulos = { kmh: NaN, vastaan: NaN, virtaKmh: NaN };
    if (!isFinite(u) || !isFinite(v)) return tulos;
    tulos.virtaKmh = Math.hypot(u, v) * 3.6;
    if (!isFinite(kmh) || !isFinite(suuntaAst) || kmh < 0.5) return tulos;
    const k = suuntaAst * Math.PI / 180, ms = kmh / 3.6;
    const vx = ms * Math.sin(k) - u, vy = ms * Math.cos(k) - v;
    tulos.kmh = Math.hypot(vx, vy) * 3.6;
    tulos.vastaan = -(u * Math.sin(k) + v * Math.cos(k)) * 3.6;
    return tulos;
  }

  const Nopeus = { OLETUKSET, tasattuNopeus, suunta, halytys, etaisyysM, vedenSuhteen };
  if (typeof module !== 'undefined' && module.exports) module.exports = Nopeus;
  else root.Nopeus = Nopeus;
})(typeof window !== 'undefined' ? window : this);
