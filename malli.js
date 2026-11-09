/* Merilohitutka – malli.js
 * Paluuikkunan laskenta. Puhtaat funktiot: ei verkkoa, ei käyttöliittymää.
 * Toimii selaimessa (window.Malli) ja Nodessa (module.exports) testejä varten.
 */
(function (root) {
  'use strict';

  const OLETUKSET = {
    kohdeNimi: 'Köpmanholmen',
    kohdeLat: 63.806844,   // 63°48'24.64" N (Hannun antama)
    kohdeLon: 22.671069,   // 22°40'15.85" E
    rajaKeskituuli: 10,    // m/s, Hannun raja
    rajaPuuska: 14,        // m/s, ehdotus (säädettävä)
    nopeusNouseva: 25,     // km/h, Hannun 25–35 alapää: tällä lasketaan lähtöhetki
    nopeusKova: 8,         // km/h, "tosikova keli"
    nopeusTyyni: 35,       // km/h, Hannun 35–40 alapää
    reittikerroin: 1.2,    // suora viiva × kerroin = arvioitu reitin pituus (arvio, säädä)
    marginaaliMin: 0,      // Hannun valinta: ei marginaalia
    esivaroitusMin: 30,    // keltainen näin monta min ennen viimeistä lähtöhetkeä (ei siirrä lähtöhetkeä)
    alakanttiEro: 2,       // m/s: asema mittaa näin paljon ennustetta enemmän -> keltainen
    nakyvyysRaja: 1000,    // m: Tankarin näkyvyys alle tämän -> keltainen
    havaintoVanhaMin: 60,  // havaintoa vanhempi kuin tämä ei ratkaise tilaa
    alueSadeKm: 50,        // kauempana kohteesta (esim. kotona) paluuikkunaa ei lasketa
    // Asema: FMI:n asemanumero (101661 = Kokkola Tankar, varmistettu sijainnista) tai "Nimi@lat,lon" = lähin asema pisteestä.
    // Kallanin piste = majakan sijainti (Hannu 9.11.2026: 63°45'05.29" N, 22°31'21.95" E). Asemanumeroa ei löytynyt.
    asemat: ['Pietarsaari Kallan@63.7515,22.5228', '101661']
  };

  function rad(d) { return d * Math.PI / 180; }

  /** Isoympyräetäisyys km (haversine, R = 6371 km). */
  function etaisyysKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Matka-aika minuutteina. */
  function aikaMin(km, kmh) {
    if (!(kmh > 0) || !isFinite(km)) return NaN;
    return km / kmh * 60;
  }

  /**
   * Ensimmäinen hetki, jolloin arvo saavuttaa rajan. Rivien välissä lineaarinen interpolointi.
   * rivit: [{t: Date, [kentta]: number}] aikajärjestyksessä. Palauttaa Date tai null.
   */
  function ylitysHetki(rivit, kentta, raja) {
    let edellinen = null;
    for (const r of rivit) {
      const v = r[kentta];
      if (!isFinite(v)) continue;
      if (v >= raja) {
        if (!edellinen) return new Date(r.t.getTime());
        const v0 = edellinen[kentta];
        const f = (raja - v0) / (v - v0);
        const t0 = edellinen.t.getTime();
        return new Date(t0 + f * (r.t.getTime() - t0));
      }
      edellinen = r;
    }
    return null;
  }

  /** Ennusteen arvo hetkellä t (lineaarinen interpolointi). */
  function arvoHetkella(rivit, kentta, t) {
    const ms = t.getTime();
    let ed = null;
    for (const r of rivit) {
      if (!isFinite(r[kentta])) continue;
      if (r.t.getTime() >= ms) {
        if (!ed) return r[kentta];
        const f = (ms - ed.t.getTime()) / (r.t.getTime() - ed.t.getTime());
        return ed[kentta] + f * (r[kentta] - ed[kentta]);
      }
      ed = r;
    }
    return ed ? ed[kentta] : NaN;
  }

  /** Yhdistää kahden pisteen ennusteet: joka tunnille suurempi keskituuli ja suurempi puuska. */
  function yhdistaEnnusteet(a, b) {
    if (!a || !a.length) return b || [];
    if (!b || !b.length) return a;
    const map = new Map();
    for (const r of a.concat(b)) {
      const k = r.t.getTime();
      const vanha = map.get(k);
      if (!vanha) { map.set(k, { t: r.t, ws: r.ws, wg: r.wg, wd: r.wd }); continue; }
      vanha.ws = maxNum(vanha.ws, r.ws);
      vanha.wg = maxNum(vanha.wg, r.wg);
    }
    return Array.from(map.values()).sort((x, y) => x.t - y.t);
  }

  function maxNum(x, y) {
    if (!isFinite(x)) return y;
    if (!isFinite(y)) return x;
    return Math.max(x, y);
  }

  /**
   * Paluuikkunan arvio.
   * syote: { nyt: Date, sijainti: {lat, lon}|null, asetukset, havainnot: [{nimi, aika: Date, ws, wg, vis}], ennuste: [{t, ws, wg}] }
   */
  function arvioi(syote) {
    const a = Object.assign({}, OLETUKSET, syote.asetukset || {});
    const nyt = syote.nyt;
    const tulos = {
      tila: 'tuntematon', // vihrea | keltainen | punainen | tuntematon
      syyt: [],
      matkaSuoraKm: NaN, matkaKm: NaN,
      paluu: { nouseva: NaN, kova: NaN, tyyni: NaN },
      ylitys: null, ylitysSyy: null,
      lahtoViimeistaan: null, minuuttiaLahtoon: NaN,
      kaukana: false
    };
    let taso = 0; // 0 vihreä, 1 keltainen, 2 punainen
    const nosta = (t, syy) => { taso = Math.max(taso, t); tulos.syyt.push(syy); };

    // 1. Matka ja paluuajat
    if (syote.sijainti && isFinite(syote.sijainti.lat)) {
      tulos.matkaSuoraKm = etaisyysKm(syote.sijainti.lat, syote.sijainti.lon, a.kohdeLat, a.kohdeLon);
      tulos.matkaKm = tulos.matkaSuoraKm * a.reittikerroin;
      tulos.paluu.nouseva = aikaMin(tulos.matkaKm, a.nopeusNouseva);
      tulos.paluu.kova = aikaMin(tulos.matkaKm, a.nopeusKova);
      tulos.paluu.tyyni = aikaMin(tulos.matkaKm, a.nopeusTyyni);
      if (tulos.matkaSuoraKm > a.alueSadeKm) {
        tulos.kaukana = true;
        tulos.syyt.push('Olet ' + Math.round(tulos.matkaSuoraKm) + ' km päässä kohteesta: paluuikkunaa ei lasketa');
      }
    }

    // 2. Havainnot (Kallan, Tankar): raja ylittynyt nyt?
    const tuoreet = (syote.havainnot || []).filter(h => h && h.aika &&
      (nyt - h.aika) / 60000 <= a.havaintoVanhaMin);
    for (const h of syote.havainnot || []) {
      if (h && h.aika && (nyt - h.aika) / 60000 > a.havaintoVanhaMin) {
        tulos.syyt.push(h.nimi + ': havainto yli ' + a.havaintoVanhaMin + ' min vanha, ei ratkaise tilaa');
      }
    }
    for (const h of tuoreet) {
      if (h.ws >= a.rajaKeskituuli) nosta(2, h.nimi + ': keskituuli ' + h.ws.toFixed(1) + ' m/s ≥ ' + a.rajaKeskituuli);
      if (h.wg >= a.rajaPuuska) nosta(2, h.nimi + ': puuska ' + h.wg.toFixed(1) + ' m/s ≥ ' + a.rajaPuuska);
      if (h.nimi && /tankar/i.test(h.nimi) && isFinite(h.vis) && h.vis < a.nakyvyysRaja) {
        nosta(1, h.nimi + ': näkyvyys ' + Math.round(h.vis) + ' m (sumu?)');
      }
    }

    // 3. Ennuste: milloin raja ylittyy
    const ennuste = (syote.ennuste || []).filter(r => r.t.getTime() >= nyt.getTime() - 3600000);
    if (ennuste.length) {
      const tWs = ylitysHetki(ennuste, 'ws', a.rajaKeskituuli);
      const tWg = ylitysHetki(ennuste, 'wg', a.rajaPuuska);
      let t = null, syy = null;
      if (tWs && (!tWg || tWs <= tWg)) { t = tWs; syy = 'keskituuli ' + a.rajaKeskituuli + ' m/s'; }
      else if (tWg) { t = tWg; syy = 'puuska ' + a.rajaPuuska + ' m/s'; }
      if (t && t < nyt) t = new Date(nyt.getTime());
      tulos.ylitys = t; tulos.ylitysSyy = syy;

      // Ennuste alakanttiin? Verrataan aseman havaintoa ennusteeseen SAMASSA pisteessä (h.ennWs),
      // ei kohteen saaristopisteeseen: avoin majakka-asema tuulee luonnostaan enemmän.
      for (const h of tuoreet) {
        if (isFinite(h.ennWs) && isFinite(h.ws) && h.ws - h.ennWs >= a.alakanttiEro) {
          nosta(1, h.nimi + ' mittaa ' + h.ws.toFixed(1) + ' m/s, ennuste aseman kohdalla ' + h.ennWs.toFixed(1) + ' m/s: ennuste alakanttiin');
        }
      }

      if (t && isFinite(tulos.paluu.nouseva) && !tulos.kaukana) {
        const lahto = new Date(t.getTime() - (tulos.paluu.nouseva + a.marginaaliMin) * 60000);
        tulos.lahtoViimeistaan = lahto;
        tulos.minuuttiaLahtoon = (lahto - nyt) / 60000;
        if (tulos.minuuttiaLahtoon <= 0) nosta(2, 'Ennusteen mukaan ' + syy + ' ylittyy ennen kuin ehdit perille');
        else if (tulos.minuuttiaLahtoon <= a.esivaroitusMin) nosta(1, 'Viimeiseen lähtöhetkeen alle ' + a.esivaroitusMin + ' min');
      }
    } else {
      tulos.syyt.push('Ennustetta ei saatu');
    }

    const tiedossa = ennuste.length || tuoreet.length;
    if (tiedossa && !syote.sijainti) {
      if (tulos.ylitys) taso = Math.max(taso, 1); // ylitys tulossa, lähtöaikaa ei voi laskea
      tulos.syyt.push('Ei GPS-sijaintia: paluuaikaa ei voi laskea');
    }
    tulos.tila = !tiedossa ? 'tuntematon' : ['vihrea', 'keltainen', 'punainen'][taso];
    if (tulos.kaukana) tulos.tila = 'kaukana'; // yli alueen säteen: ei hälytyksiä, syyt näytetään tietona
    return tulos;
  }

  const Malli = { OLETUKSET, etaisyysKm, aikaMin, ylitysHetki, arvoHetkella, yhdistaEnnusteet, arvioi };
  if (typeof module !== 'undefined' && module.exports) module.exports = Malli;
  else root.Malli = Malli;
})(typeof window !== 'undefined' ? window : this);
