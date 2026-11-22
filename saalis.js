/* Merilohitutka – saalis.js (v72, 22.11.2026)
 * KALA KIINNI JA SAALISKIRJANPITO. Hannun valinnat 22.11.2026: täydennykseen lisäksi viehe, siiman pituus ja paino siimassa (g);
 * 4 mpk:n rajalla (±100 m) "Kysy erikseen"; ICES-ruutu ja kunta näytetään Omakala-ilmoitusta varten.
 *
 * SÄÄNTÖ (Hannu 22.11.): saalistiedot vain tähän puhelimeen (localStorage 'mlt_saalisloki' ja klooni venepuhelimeen),
 * EI GitHubiin eikä mihinkään verkkopyyntöön. Varasto ja sivu ovat julkisia.
 *
 * UISTELUTUTKAN OPIT (kirjaus.js): yksi napautus tallentaa heti paikan ja ajan (v151: paikat katosivat, kun tallennus odotti
 * nappia); täydennys myöhemmin saman rivin tunnisteella; jokaisella rivillä yksilöllinen id (v232: tunnisteettomat rivit
 * sotkivat muokkauksen); kaikki data jää talteen.
 *
 * OMAKALA [L Finlex VNA 716/2024]: 3 § laji, pituus, rasvaevän leikkaus, pyyntipäivä, pyyntiväline, pyyntialue, vapautus
 * (vapautetun pituus vähintään 5 cm:n tarkkuudella); 4 § Itämerellä "pienruutujen mukaisesti" (ICES) + kunta, jonka alueella
 * pyynti tapahtui. Lohesta merellä päivittäin ja sähköisesti, myös pyyntitapa (rannalta/alukselta/…) [L SVK 2026].
 * Paino ei pakollinen [L Luke]. Omakalaan ei ole avointa rajapintaa → sovellus kokoaa tekstin kopioitavaksi.
 *
 * ICES [L ices.dk]: rivit 30′ (01 = 36°00′N), sarakkeet 1° (A0–A3 = 44°W–40°W, sitten B–M ilman I:tä 10° välein; H0 = 20°E);
 * alaruutu (pienruutu) 9 osaa 10′ × 20′, numerointi pohjoisesta etelään ja lännestä itään (1 = luode, 9 = kaakko).
 * Että Omakala kysyy juuri tätä 5-merkkistä muotoa (esim. 56H25), ei ole tarkistettu [A] – teksti näyttää molemmat.
 *
 * LOHIKIINTIÖ [L SVK 2026, osa-alueet 29–31; kartta.js lohisaanto]: 4 mpk:n sisäpuolella 1.5.–31.8. 2 lohta/vrk
 * (rasvaevällinen tai -eväleikattu); muulloin ja ulkopuolella 1 rasvaeväleikattu/vrk, rasvaevällinen heti takaisin; sisäpuolella
 * kauden ulkopuolella kalastus loppuu päiväksi ensimmäisen jälkeen. Laskuri on YKSINKERTAISTETTU [A]: yhden kalastajan päivän
 * otetut lohet lasketaan yhteen vyöhykkeestä riippumatta, ja raja tulee nykyisestä paikasta. Virallinen tieto kalastusrajoitus.fi.
 */
(function (root) {
  'use strict';

  const LS = 'mlt_saalisloki';
  const LAJIT = ['lohi', 'taimen', 'siika', 'muu'];
  const ILMOITETTAVAT = ['lohi', 'taimen'];   // VNA 716/2024 1 §: lohi, järvilohi, taimen, ankerias … (merellä nämä)
  const TULOKSET = { otettu: 'otettu', vapautettu: 'vapautettu', karkasi: 'karkasi' };

  // ------------------------------------------------------------ tallennus (vain tämä puhelin)
  function lue(ls) {
    try { const l = JSON.parse(ls.getItem(LS)); return Array.isArray(l) ? l.filter(x => x && x.id != null) : []; } catch (e) { return []; }
  }
  function tallenna(ls, lista) {
    try { ls.setItem(LS, JSON.stringify(lista)); return true; } catch (e) { return false; }
  }
  /** Uusi rivi heti napautuksesta. o: { aika (Date), lat, lon, tark, nopeus, suunta, alue, reissu, laji } */
  function uusi(lista, o) {
    let id = (o.aika || new Date()).getTime();
    while (lista.some(x => x.id === id)) id++;
    const r = { id, aika: new Date(id).toISOString(), lat: o.lat, lon: o.lon, tark: o.tark == null ? null : Math.round(o.tark),
      nopeus: o.nopeus == null ? null : Math.round(o.nopeus * 10) / 10, suunta: o.suunta == null ? null : Math.round(o.suunta),
      alue: o.alue || null, reissu: o.reissu || null, laji: o.laji || 'lohi', tulos: null, rasvaeva: null, pituus: null, paino: null,
      viehe: null, siima: null, painoSiimassa: null, huom: null, mpk: o.mpk || null, vesialue: o.vesialue || null,
      ices: (o.lat != null && o.lon != null) ? icesRuutu(o.lat, o.lon) : null, kunta: o.kunta || null, olot: null,
      omakala: null, taydennetty: null };
    lista.push(r);
    return r;
  }
  function etsi(lista, id) { return lista.find(x => x.id === id) || null; }
  /** Muutokset riville (vain tunnetut kentät). Palauttaa rivin tai null. */
  const MUOKATTAVAT = ['laji', 'tulos', 'rasvaeva', 'pituus', 'paino', 'viehe', 'siima', 'painoSiimassa', 'huom', 'omakala', 'olot', 'kunta', 'vesialue'];
  function paivita(lista, id, muutokset, nyt) {
    const r = etsi(lista, id);
    if (!r) return null;
    let kayttaja = false;
    for (const k of Object.keys(muutokset || {})) {
      if (k === 'mpkValinta') { r.mpk = Object.assign({}, r.mpk || {}, { valinta: muutokset[k] }); kayttaja = true; continue; }
      if (!MUOKATTAVAT.includes(k)) continue;
      r[k] = muutokset[k];
      if (k !== 'olot' && k !== 'kunta' && k !== 'vesialue') kayttaja = true;
    }
    if (kayttaja) r.taydennetty = (nyt || new Date()).toISOString();
    return r;
  }
  function poista(lista, id) { const i = lista.findIndex(x => x.id === id); if (i >= 0) lista.splice(i, 1); return i >= 0; }

  // ------------------------------------------------------------ ICES
  const SARAKKEET = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M'];
  function icesRuutu(lat, lon) {
    if (!(lat >= 36 && lat < 85.5 && lon >= -44 && lon < 68.5)) return null;
    const rivi = Math.floor((lat - 36) * 2) + 1;
    let sar;
    if (lon < -40) sar = 'A' + Math.floor(lon + 44);
    else { const k = Math.floor(lon + 40); sar = SARAKKEET[Math.floor(k / 10)] + (k % 10); }
    const ruutu = String(rivi).padStart(2, '0') + sar;
    const yla = 36 + rivi * 0.5, vasen = Math.floor(lon);
    const r = Math.min(2, Math.floor((yla - lat) * 6)), s = Math.min(2, Math.floor((lon - vasen) * 3));   // 10′ ja 20′
    const pien = s * 3 + r + 1;
    return { ruutu, pien, koodi: ruutu + pien };
  }

  // ------------------------------------------------------------ 4 mpk ja kiintiö
  const kesaa = d => { const k = d.getMonth() + 1; return k >= 5 && k <= 8; };
  const samaPaiva = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  /** Rivin vyöhyke: Hannun valinta rajalla, muuten GPS:n mukaan. true/false/null (ei tiedossa). */
  function sisalla(r) {
    if (!r || !r.mpk) return null;
    if (r.mpk.valinta === 'sisalla') return true;
    if (r.mpk.valinta === 'ulkona') return false;
    if (r.mpk.rajalla) return null;   // kysytään
    return r.mpk.sisalla == null ? null : !!r.mpk.sisalla;
  }
  /** Rivin sääntöhuomautus (otettu rasvaevällinen lohi, kun sitä ei saa ottaa). */
  function rivinVaroitus(r) {
    if (!r || r.laji !== 'lohi' || r.tulos !== 'otettu' || r.rasvaeva !== 'ehja') return '';
    const s = sisalla(r), kesa = kesaa(new Date(r.aika));
    if (s === true && kesa) return '';
    if (s === null && kesa) return 'rasvaevällisen saa ottaa vain 4 mpk:n sisäpuolella 1.5.–31.8. – valitse puoli';
    return 'rasvaevällinen lohi pitää vapauttaa' + (s ? ' (4 mpk:n sisäpuolella vain 1.5.–31.8. saa ottaa)' : ' (4 mpk:n ulkopuolella)');
  }
  /**
   * Päivän lohikiintiö. tila = { sisalla: true/false/null } nykyisestä paikasta. Palauttaa
   * { otettu, leikattuja, ehjia, raja, taysi, loppui, teksti, varoitukset[] }.
   */
  function kiintio(lista, nyt, tila) {
    const tanaan = lista.filter(r => r.laji === 'lohi' && r.tulos === 'otettu' && samaPaiva(new Date(r.aika), nyt));
    const leikattuja = tanaan.filter(r => r.rasvaeva === 'leikattu').length, ehjia = tanaan.filter(r => r.rasvaeva === 'ehja').length;
    const otettu = tanaan.length, kesa = kesaa(nyt), s = tila ? tila.sisalla : null;
    const varoitukset = tanaan.map(rivinVaroitus).filter(Boolean);
    let raja, taysi, loppui = false, teksti;
    if (s === true && kesa) {
      raja = 2; taysi = otettu >= 2;
      teksti = `Lohia otettu tänään ${otettu}/2 (4 mpk:n sisäpuolella 1.5.–31.8., rasvaevällinen tai -eväleikattu)`;
    } else {
      raja = 1; taysi = leikattuja + ehjia >= 1;
      loppui = s === true && taysi;
      teksti = `Lohia otettu tänään ${otettu}/1 (${s === true ? '4 mpk:n sisäpuolella kauden ulkopuolella' : s === false ? '4 mpk:n ulkopuolella' : 'puoli ei tiedossa'}: 1 rasvaeväleikattu)`
        + (loppui ? ' – kalastus loppuu tältä päivältä' : taysi ? ' – kiintiö täynnä, lohet takaisin' : '');
    }
    if (s === null) varoitukset.push('4 mpk:n puoli ei tiedossa (ei sijaintia tai rajalla) – raja tiukemman säännön mukaan');
    return { otettu, leikattuja, ehjia, raja, taysi, loppui, teksti, varoitukset };
  }

  // ------------------------------------------------------------ Omakala
  const luku = (v, d) => (v == null || !isFinite(v)) ? null : Number(v).toFixed(d).replace('.', ',');
  function pvmTeksti(iso) { const d = new Date(iso); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; }
  function kloTeksti(iso) { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; }
  /** Pitääkö rivi ilmoittaa Omakalaan (laji ja tulos). */
  function ilmoitettava(r) { return !!r && ILMOITETTAVAT.includes(r.laji) && (r.tulos === 'otettu' || r.tulos === 'vapautettu'); }
  /** Puuttuvat pakolliset tiedot Omakalaa varten. */
  function puuttuu(r) {
    const p = [];
    if (!r.tulos) p.push('tulos');
    if (r.pituus == null) p.push('pituus');
    if (['lohi', 'taimen'].includes(r.laji) && !r.rasvaeva) p.push('rasvaevä');
    if (!r.kunta) p.push('kunta');
    return p;
  }
  function kuntaTeksti(r) {
    if (!r.kunta) return 'valitse Omakalassa (ei tiedossa: iskupaikka ei ole yleisellä vesialueella)';
    return r.kunta.nimi + (r.kunta.lahde ? ` (${r.kunta.lahde})` : '');
  }
  function omakalaTeksti(r) {
    const vap = r.tulos === 'vapautettu';
    const pit = r.pituus == null ? '?' : vap ? `${Math.round(r.pituus / 5) * 5} cm (vapautettu, 5 cm:n tarkkuus)` : `${Math.round(r.pituus)} cm`;
    return [
      `Omakala – ${r.laji}`,
      `Pyyntipäivä: ${pvmTeksti(r.aika)} (klo ${kloTeksti(r.aika)})`,
      `Laji: ${r.laji} · Pituus: ${pit}` + (r.paino != null ? ` · Paino: ${luku(r.paino, 1)} kg` : ''),
      (['lohi', 'taimen'].includes(r.laji) ? `Rasvaevä: ${r.rasvaeva === 'leikattu' ? 'leikattu' : r.rasvaeva === 'ehja' ? 'ehjä (leikkaamaton)' : '?'} · ` : '')
        + `Vapautettu: ${vap ? 'kyllä' : r.tulos === 'otettu' ? 'ei' : '?'}`,
      'Pyyntiväline: vapa (vetouistelu) · Pyyntitapa: alukselta',
      `Pyyntialue: ICES-ruutu ${r.ices ? r.ices.ruutu : '?'}, pienruutu ${r.ices ? r.ices.pien + ' (' + r.ices.koodi + ')' : '?'} · Kunta: ${kuntaTeksti(r)}`,
    ].join('\n');
  }

  // ------------------------------------------------------------ olosuhteet iskuhetkellä (puhdas: data annetaan)
  /**
   * d = päivän purettu data (nakyma: ajat, phy, wav, tuuli), ms = iskuhetki, KM = KarttaMalli, lohivali = [min, max].
   * Palauttaa { malliAika, pinta, virta, virtaSuunta, aalto, jakso, tuuli, puuska, tuuliSuunta, kerrosYla, kerrosAla } (puuttuvat pois).
   */
  function olot(d, ms, lat, lon, KM, lohivali) {
    const o = {};
    if (!d || !KM) return o;
    const pyor = (v, n) => (v == null || !isFinite(v)) ? undefined : Math.round(v * Math.pow(10, n)) / Math.pow(10, n);
    try {
      const ajat = d.ajat || [];
      if (ajat.length && d.phy) {
        const t = KM.lahinAika(ajat, ms);
        o.malliAika = ajat[t];
        o.pinta = pyor(KM.lahinArvo(d.phy, 'lampo', t, lat, lon), 2);
        const u = KM.lahinArvo(d.phy, 'u', t, lat, lon), v = KM.lahinArvo(d.phy, 'v', t, lat, lon);
        if (isFinite(u) && isFinite(v)) { const vi = KM.virta(u, v); o.virta = pyor(vi.nopeus * 3.6, 2); o.virtaSuunta = Math.round(vi.suunta); }
        if (KM.profiiliPisteessa && KM.kerros && lohivali) {
          const pr = KM.profiiliPisteessa(d.phy, t, lat, lon);
          const k = pr ? KM.kerros(pr.arvot, pr.syvyydet, lohivali[0], lohivali[1]) : null;
          if (k && k.loytyi) { o.kerrosYla = pyor(k.yla, 1); o.kerrosAla = k.pohjaan ? 'pohja' : pyor(k.ala, 1); }
        }
      }
      if (d.wav && d.wav.ajat && d.wav.ajat.length) {
        const tw = KM.lahinAika(d.wav.ajat, ms);
        o.aalto = pyor(KM.lahinArvo(d.wav, 'hs', tw, lat, lon), 2);
        if (d.wav.jakso) o.jakso = pyor(KM.lahinArvo(d.wav, 'jakso', tw, lat, lon), 1);
      }
      const tu = d.tuuli;
      if (tu && tu.ajat && tu.ajat.length && tu.pisteet && tu.pisteet.length) {
        const ti = KM.lahinAika(tu.ajat, ms);
        let paras = 0, pd = Infinity;
        tu.pisteet.forEach(([la, lo], i) => { const dd = Math.hypot(la - lat, (lo - lon) * Math.cos(lat * Math.PI / 180)); if (dd < pd) { pd = dd; paras = i; } });
        const ws = tu.ws[ti] && tu.ws[ti][paras], wd = tu.wd[ti] && tu.wd[ti][paras], wg = tu.wg && tu.wg[ti] && tu.wg[ti][paras];
        if (ws != null) o.tuuli = pyor(ws, 1);
        if (wg != null) o.puuska = pyor(wg, 1);
        if (wd != null) o.tuuliSuunta = Math.round(wd);
      }
    } catch (e) { o.virhe = String(e && e.message || e).slice(0, 80); }
    Object.keys(o).forEach(k => o[k] === undefined && delete o[k]);
    return o;
  }

  // ------------------------------------------------------------ näyttö ja vienti
  function lyhyt(r, ilmanPvm) {
    const d = new Date(r.aika);
    const osat = [r.laji, r.pituus != null ? Math.round(r.pituus) + ' cm' : null, r.tulos === 'vapautettu' ? 'vapautettu' : r.tulos === 'karkasi' ? 'karkasi' : null,
      ilmanPvm ? null : `${d.getDate()}.${d.getMonth() + 1}.`];
    return osat.filter(Boolean).join(' ');
  }
  /** Kartan havaintoina (kartta.js piirtää tyypin 'saalis' punaisena; karanneet pois). */
  function havainnot(lista) {
    return lista.filter(r => r.lat != null && r.lon != null && r.tulos !== 'karkasi').map(r => ({ tyyppi: 'saalis', laji: 'saalis', lat: r.lat, lon: r.lon,
      nimi: lyhyt(r), teksti: lyhyt(r) + (r.viehe ? ', ' + r.viehe : '') + (r.siima != null ? `, siimaa ${r.siima} m` : '') + (r.painoSiimassa != null ? `, paino ${r.painoSiimassa} g` : ''),
      varmuus: null, lisa: null, oma: true }));
  }
  const CSV_KENTAT = ['id', 'aika', 'lat', 'lon', 'tark', 'nopeus', 'suunta', 'alue', 'reissu', 'laji', 'tulos', 'rasvaeva', 'pituus', 'paino', 'viehe', 'siima',
    'painoSiimassa', 'huom', 'mpk_sisalla', 'mpk_m', 'mpk_valinta', 'vesialue', 'ices', 'kunta', 'pinta', 'virta', 'virtaSuunta', 'aalto', 'jakso', 'tuuli', 'puuska',
    'tuuliSuunta', 'kerrosYla', 'kerrosAla', 'malliAika', 'omakala', 'taydennetty'];
  function csv(lista) {
    const sol = v => { if (v == null) return ''; const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rivit = lista.map(r => {
      const o = r.olot || {}, m = r.mpk || {};
      const arvo = { mpk_sisalla: m.sisalla, mpk_m: m.m != null ? Math.round(m.m) : null, mpk_valinta: m.valinta, ices: r.ices && r.ices.koodi,
        kunta: r.kunta && r.kunta.nimi };
      return CSV_KENTAT.map(k => sol(k in arvo ? arvo[k] : k in o ? o[k] : r[k])).join(';');
    });
    return '﻿' + [CSV_KENTAT.join(';')].concat(rivit).join('\r\n');
  }

  const Saalis = { LS, LAJIT, TULOKSET, ILMOITETTAVAT, lue, tallenna, uusi, etsi, paivita, poista, icesRuutu, sisalla, rivinVaroitus, kiintio,
    ilmoitettava, puuttuu, omakalaTeksti, olot, lyhyt, havainnot, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = Saalis; else root.Saalis = Saalis;
})(typeof window !== 'undefined' ? window : this);
