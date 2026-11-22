"""Merilohitutka – hae_vesialueet.py (v71, 22.11.2026)

Valtion yleinen vesialue kartalle (Hannu 22.11.2026: "A" = hakuajo GitHubin salaisuudella, "tuleehan selkeä viiva missä raja menee").

LÄHDE [L maanmittauslaitos.fi 22.11.2026]: Kiinteistötietojen kyselypalvelu (OGC API Features), avoimet tuotteet, API-avaimella
maksuton; https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3/, kokoelma PalstanSijaintitiedot,
haku tunnuksella ?kiinteistotunnus=14 numeroa (esimerkki MML:n ohjeessa). Lisenssi CC BY 4.0.

TUNNISTUS [L]: yleisen vesialueen kiinteistötunnus on kunta-894-1-1 (esim. Porin yleinen vesialue 609-894-1-1, Metsähallitus;
678-894-1-1 "Yleinen vesialue"; 240-894-1-1 "Kemin yleinen vesialue"); myös muoto kunta-894-1-0 (72-894-1-0). Puhelinkoe v69
(22.11.2026): 440-894-1-1 (Luoto, myös Kolmoispatti), 475-, 499-, 545- ja 609-894-1-1 löytyivät ulkomereltä.

HAKU: jokaiselle rannikkokunnalle (KUNNAT) tunnukset 894-1-1, 894-1-0, 894-2-1 ja 894-1-2 (puuttuva palauttaa tyhjän).
Tulos välimuistiin ajon ajaksi (sama haku kaikille alueille). Uusinta 30 vrk:n välein; muuten julkaistu tiedosto käytetään.
Ilman avainta (ympäristömuuttuja MML_API_KEY puuttuu) käytetään julkaistua tiedostoa, jos sellainen on.

VIIVA: palstojen reunat, joista on poistettu kahden yleisen vesialueen yhteiset reunat (kuntien raja yleisellä vesialueella).
Jäljelle jää raja kylien/osakaskuntien vesiin ja saariin sekä ulkoreuna (aluemeren raja / valtakunnan raja). Kiinteistörekisterin
raja sellaisenaan (ei laskettu kuten 4 mpk), mutta ei virallinen rajanäyttö eikä navigointiin.

AVAIN ei tulostu lokiin (peita(); GitHub peittää salaisuudet lisäksi itse).

v72 (22.11.2026, Hannun kuva 18.02): Luodon alueen pohjoisreuna Ohtakarin kohdalla näyttää kuntarajalta (Kokkola–Kalajoki), mutta
Kalajoen (071) yleistä vesialuetta ei löytynyt muodoilla 894-1-1/1-0/2-1/1-2. Lisätty muotoja (MUODOT) ja KOEPISTEET: palstat
pisteen kohdalta (bbox ±50 m); löytynyt 894-tunnus haetaan mukaan, ja pisteiden tunnukset tallentuvat tiedoston kohtaan "haku"
(luettavissa julkaistusta tiedostosta). Virheet eriteltyinä samaan kohtaan. VERSIO 2 → uusi haku heti (muuten 30 vrk).
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hae_syvyys as HS  # noqa: E402

VERSIO = 2
OSOITE = "https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3"
KOKOELMA = "PalstanSijaintitiedot"
YMPARISTO = "MML_API_KEY"
UUSINTA_VRK = 30
REUNA_KM = 10            # alueen ympäriltä mukaan otettavat monikulmiot
TAUKO_S = 0.3
SIVUJA_MAX = 20
OTSAKE = {"User-Agent": "merilohitutka/72 (github.com/Lohirosvo/merilohitutka; kerran kuussa)",
          "Accept": "application/geo+json, application/json"}
LAHDE = "Maanmittauslaitos, Kiinteistötietojen kyselypalvelu (OGC API Features), avoimet tuotteet, CC BY 4.0"
HUOM = "Yleinen vesialue = kiinteistötunnus kunta-894-…; kiinteistörekisterin raja, ei virallinen rajanäyttö, ei navigointiin."
# Rannikkokunnat Kalajoelta Raumalle [A: kuntanumerot muistista; puuttuva kunta näkyy lokissa, ylimääräinen palauttaa tyhjän].
KUNNAT = {"071": "Kalajoki", "272": "Kokkola", "440": "Luoto", "598": "Pietarsaari", "599": "Pedersöre", "893": "Uusikaarlepyy",
          "946": "Vöyri", "499": "Mustasaari", "905": "Vaasa", "475": "Maalahti", "280": "Korsnäs", "545": "Närpiö",
          "231": "Kaskinen", "287": "Kristiinankaupunki", "484": "Merikarvia", "609": "Pori", "051": "Eurajoki", "684": "Rauma"}
MUODOT = [(1, 1), (1, 0), (2, 1), (1, 2), (1, 3), (2, 0), (2, 2), (3, 1)]   # (ryhmä, yksikkö) kylänumeron 894 perässä (v72: +4)
# v72: koepisteet epävarmojen reunojen takaa (lat, lon, nimi): mikä kiinteistö siellä on?
KOEPISTEET = [(64.12, 23.25, "Ohtakarin pohjoispuoli"), (64.17, 22.95, "Kalajoen edusta ulompana"), (64.22, 23.55, "Kalajoen edusta rannempana")]

_VALIMUISTI = {}


def tunnus14(kunta, ryhma, yksikko, kyla=894):
    return f"{int(kunta):03d}{kyla:03d}{ryhma:04d}{yksikko:04d}"


def tunnus_viiva(t14):
    """'44089400010001' -> '440-894-1-1'."""
    s = str(t14)
    if len(s) == 14 and s.isdigit():
        return "-".join(str(int(x)) for x in (s[:3], s[3:6], s[6:10], s[10:]))
    return s


def peita(teksti, avain):
    t = str(teksti)
    if avain:
        t = t.replace(avain, "…" + avain[-4:]).replace(urllib.parse.quote(avain), "…" + avain[-4:])
    return t


def ilman_avainta(url):
    """Seuraavan sivun osoitteesta pois api-key (lisätään haussa uudelleen)."""
    u = urllib.parse.urlsplit(url)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(u.query, keep_blank_values=True) if k != "api-key"]
    return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, urllib.parse.urlencode(q), u.fragment))


def _hae(url, avain, aika=60):
    """GET JSON; avain lisätään api-key-parametriksi. Palauttaa (json, tavut)."""
    erotin = "&" if "?" in url else "?"
    pyynto = urllib.request.Request(url + erotin + "api-key=" + urllib.parse.quote(avain), headers=OTSAKE)
    try:
        with urllib.request.urlopen(pyynto, timeout=aika) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}") from None
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(peita(f"{type(e).__name__}: {e}", avain)[:200]) from None
    return json.loads(data.decode("utf-8")), len(data)


def _renkaat(geom):
    """GeoJSON Polygon/MultiPolygon (CRS84 [lon, lat]) -> [[[(lat, lon), ...] rengas, ...] monikulmio, ...]."""
    if not geom:
        return []
    c = geom.get("coordinates") or []
    if geom.get("type") == "Polygon":
        c = [c]
    elif geom.get("type") != "MultiPolygon":
        return []
    return [[[(float(p[1]), float(p[0])) for p in rengas] for rengas in poly if len(rengas) >= 4] for poly in c]


def hae_kaikki(avain, loki=print, hae=_hae, tauko=TAUKO_S):
    """{tunnus: {"kunta", "monikulmiot": [[rengas, ...], ...]}} kaikista KUNNAT × MUODOT; välimuisti ajon ajaksi."""
    if _VALIMUISTI.get("avain") == avain and "tulos" in _VALIMUISTI:
        return _VALIMUISTI["tulos"], _VALIMUISTI["tilasto"]
    tulos, tilasto = {}, {"kutsuja": 0, "tavuja": 0, "virheet": []}
    alku = time.monotonic()
    for kunta, nimi in KUNNAT.items():
        for ryhma, yksikko in MUODOT:
            t14 = tunnus14(kunta, ryhma, yksikko)
            url = f"{OSOITE}/collections/{KOKOELMA}/items?kiinteistotunnus={t14}&limit=100"
            for _ in range(SIVUJA_MAX):
                if tilasto["kutsuja"]:
                    time.sleep(tauko)
                tilasto["kutsuja"] += 1
                try:
                    j, n = hae(url, avain)
                except Exception as e:  # noqa: BLE001
                    viesti = peita(str(e), avain)
                    tilasto["virheet"].append(f"{tunnus_viiva(t14)}: {viesti}")
                    if viesti.startswith("HTTP 401") or viesti.startswith("HTTP 403"):
                        raise RuntimeError(f"avain hylätty ({viesti})") from None
                    break
                tilasto["tavuja"] += n
                for f in j.get("features") or []:
                    p = f.get("properties") or {}
                    t = tunnus_viiva(p.get("kiinteistotunnus") or t14)
                    if t.split("-")[1:2] != ["894"]:
                        continue   # vain yleiset vesialueet (varmistus, jos haku palauttaisi muutakin)
                    m = _renkaat(f.get("geometry"))
                    if m:
                        tulos.setdefault(t, {"kunta": nimi, "monikulmiot": []})["monikulmiot"].extend(m)
                seuraava = next((L.get("href") for L in (j.get("links") or []) if L.get("rel") == "next" and L.get("href")), None)
                if not seuraava or not (j.get("features") or []):
                    break
                url = ilman_avainta(seuraava)
    tilasto["koepisteet"] = []
    for lat, lon, nimi in KOEPISTEET:   # v72
        dla, dlo = 50 / 111320, 50 / (111320 * math.cos(math.radians(lat)))
        url = f"{OSOITE}/collections/{KOKOELMA}/items?bbox={lon - dlo:.6f},{lat - dla:.6f},{lon + dlo:.6f},{lat + dla:.6f}&limit=10"
        time.sleep(tauko)
        tilasto["kutsuja"] += 1
        k = {"nimi": nimi, "lat": lat, "lon": lon, "tunnukset": []}
        try:
            j, n = hae(url, avain)
            tilasto["tavuja"] += n
            for f in j.get("features") or []:
                t = tunnus_viiva((f.get("properties") or {}).get("kiinteistotunnus") or "?")
                k["tunnukset"].append(t)
                if t.split("-")[1:2] == ["894"] and t not in tulos:   # löytyi uusi yleinen vesialue → mukaan
                    m = _renkaat(f.get("geometry"))
                    if m:
                        tulos.setdefault(t, {"kunta": KUNNAT.get(t.split("-")[0].zfill(3), "kunta " + t.split("-")[0]), "monikulmiot": []})["monikulmiot"].extend(m)
                        k["lisatty"] = t
        except Exception as e:  # noqa: BLE001
            k["virhe"] = peita(str(e), avain)[:120]
        tilasto["koepisteet"].append(k)
        loki(f"vesialueet: koepiste {nimi} ({lat}, {lon}): {', '.join(k['tunnukset']) or k.get('virhe') or 'ei palstaa'}"
             + (f" → lisätty {k['lisatty']}" if k.get("lisatty") else ""))
    tilasto["s"] = round(time.monotonic() - alku, 1)
    for t, v in sorted(tulos.items()):
        loki(f"vesialueet: {t} {v['kunta']}: {len(v['monikulmiot'])} monikulmiota, "
             f"{sum(len(r) for m in v['monikulmiot'] for r in m)} pistettä")
    loki(f"vesialueet: haettu {len(tulos)} yleistä vesialuetta, {tilasto['kutsuja']} kutsua, "
         f"{tilasto['tavuja'] / 1e6:.1f} Mt, {tilasto['s']} s" + (f"; virheitä {len(tilasto['virheet'])}" if tilasto["virheet"] else ""))
    _VALIMUISTI.update(avain=avain, tulos=tulos, tilasto=tilasto)
    return tulos, tilasto


def _laatikko(rengas):
    la = [p[0] for p in rengas]
    lo = [p[1] for p in rengas]
    return min(la), max(la), min(lo), max(lo)


def valitse(kaikki, alue, reuna_km=REUNA_KM):
    """[(tunnus, monikulmio)] joiden ulkorenkaan rajauslaatikko osuu alueeseen (+ reuna)."""
    import math
    dla = reuna_km / 111.32
    dlo = reuna_km / (111.32 * math.cos(math.radians((alue["lat_min"] + alue["lat_max"]) / 2)))
    out = []
    for t, v in sorted(kaikki.items()):
        for m in v["monikulmiot"]:
            a0, a1, o0, o1 = _laatikko(m[0])
            if a1 < alue["lat_min"] - dla or a0 > alue["lat_max"] + dla or o1 < alue["lon_min"] - dlo or o0 > alue["lon_max"] + dlo:
                continue
            out.append((t, m))
    return out


def _avain(p):
    return (round(p[0], 7), round(p[1], 7))


def jaa_janat(renkaat, tol_m=0.5):
    """Lisää renkaisiin toisten renkaiden kärkipisteet, jotka ovat janalla (T-liitos): yhteinen reuna tunnistuu silloinkin,
    kun naapurin kulmapiste puuttuu tästä renkaasta. tol_m = suurin etäisyys janasta (m)."""
    import bisect
    import math
    pisteet = sorted({_avain(p) for r in renkaat for p in r})
    lats = [p[0] for p in pisteet]
    eps = tol_m / 111320
    out = []
    for r in renkaat:
        uusi = [r[0]]
        for a, b in zip(r, r[1:]):
            ka, kb = _avain(a), _avain(b)
            kx = 111320 * math.cos(math.radians(a[0]))
            ax, ay, bx, by = a[1] * kx, a[0] * 111320, b[1] * kx, b[0] * 111320
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            lo0, lo1 = min(a[1], b[1]) - eps * 3, max(a[1], b[1]) + eps * 3
            vali = []
            if L2 > 0:
                for p in pisteet[bisect.bisect_left(lats, min(a[0], b[0]) - eps):bisect.bisect_right(lats, max(a[0], b[0]) + eps)]:
                    if p == ka or p == kb or not (lo0 <= p[1] <= lo1):
                        continue
                    px, py = p[1] * kx - ax, p[0] * 111320 - ay
                    t = (px * dx + py * dy) / L2
                    if 0 < t < 1 and abs(px * dy - py * dx) / math.sqrt(L2) < tol_m:
                        vali.append((t, p))
            uusi.extend(p for _, p in sorted(vali))
            uusi.append(b)
        out.append(uusi)
    return out


def reunaviivat(monikulmiot):
    """Reunat ilman kahden monikulmion yhteisiä janoja (kuntaraja yleisellä vesialueella). [[(lat, lon), ...], ...]"""
    laskuri = {}
    renkaat = jaa_janat([r for _, m in monikulmiot for r in m])
    for r in renkaat:
        for a, b in zip(r, r[1:]):
            if _avain(a) == _avain(b):
                continue
            k = frozenset((_avain(a), _avain(b)))
            laskuri[k] = laskuri.get(k, 0) + 1
    viivat = []
    for r in renkaat:
        janat = [(a, b) for a, b in zip(r, r[1:]) if _avain(a) != _avain(b)]
        pidetaan = [laskuri[frozenset((_avain(a), _avain(b)))] == 1 for a, b in janat]
        if not janat:
            continue
        if all(pidetaan):
            viivat.append([a for a, _ in janat] + [janat[-1][1]])
            continue
        # aloitetaan poistetun janan jälkeen, jotta renkaan alku ja loppu eivät katkea turhaan
        alku = next(i for i, k in enumerate(pidetaan) if not k) + 1
        jarj = list(range(alku, len(janat))) + list(range(0, alku))
        nyk = []
        for i in jarj:
            if pidetaan[i]:
                a, b = janat[i]
                if not nyk:
                    nyk = [a]
                nyk.append(b)
            elif nyk:
                viivat.append(nyk)
                nyk = []
        if nyk:
            viivat.append(nyk)
    return [v for v in viivat if len(v) >= 2]


def rakenna(kaikki, alue, nyt, tilasto=None):
    valitut = valitse(kaikki, alue)
    origo = [round(alue["lat_min"] - 0.5, 1), round(alue["lon_min"] - 0.5, 1)]
    viivat = reunaviivat(valitut)
    tunnukset = {}
    for t, m in valitut:
        x = tunnukset.setdefault(t, {"kunta": kaikki[t]["kunta"], "monikulmioita": 0, "pisteita": 0})
        x["monikulmioita"] += 1
        x["pisteita"] += sum(len(r) for r in m)
    return {"versio": VERSIO, "luotu": nyt.strftime("%Y-%m-%dT%H:%M:%SZ"), "alue": alue, "lahde": LAHDE, "huom": HUOM,
            "osoite": f"{OSOITE}/collections/{KOKOELMA}", "origo": origo, "kerroin": HS.KERROIN, "tunnukset": tunnukset,
            "monikulmiot": [{"t": t, "r": [HS.koodaa(r, origo) for r in m]} for t, m in valitut],
            "viivat": [HS.koodaa(v, origo) for v in viivat],
            "tilasto": {"monikulmioita": len(valitut), "viivoja": len(viivat), "pisteita": sum(len(r) for _, m in valitut for r in m)},
            "haku": {"kutsuja": (tilasto or {}).get("kutsuja"), "virheet": ((tilasto or {}).get("virheet") or [])[:10],
                     "koepisteet": (tilasto or {}).get("koepisteet") or [], "muodot": ["894-%d-%d" % m for m in MUODOT]}}


def _hae_vanha(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=OTSAKE), timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _kirjoita(polku, sis):
    with open(polku, "w", encoding="utf-8") as f:
        json.dump(sis, f, ensure_ascii=False, separators=(",", ":"))


def paivita(kansio, sivun_osoite, loki=print, alue=None, nyt=None, hae_vanha=_hae_vanha, hae=_hae, avain=None, tauko=TAUKO_S):
    """Kirjoittaa kansio/vesialueet.json. Palauttaa tilan meri.json:iin: {tila, luotu?, viesti?, maara?}."""
    nyt = nyt or datetime.now(timezone.utc)
    avain = (avain if avain is not None else os.environ.get(YMPARISTO, "")).strip()
    polku = os.path.join(kansio, "vesialueet.json")
    vanha = None
    try:
        vanha = hae_vanha(sivun_osoite + "vesialueet.json")
    except Exception as e:  # noqa: BLE001
        loki(f"vesialueet: edellistä ei saatu ({str(e)[:80]})")
    kelpaa = bool(vanha and vanha.get("versio") == VERSIO and vanha.get("alue") == alue and isinstance(vanha.get("viivat"), list))
    if kelpaa:
        try:
            ika = (nyt - datetime.strptime(vanha["luotu"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)).days
        except Exception:  # noqa: BLE001
            ika = 999
        if ika < UUSINTA_VRK:
            _kirjoita(polku, vanha)
            loki(f"vesialueet: käytetään edellistä ({ika} vrk vanha)")
            return {"tila": "ok", "luotu": vanha["luotu"], "maara": len(vanha.get("tunnukset") or {})}
    if not avain:
        loki(f"vesialueet: ei avainta ({YMPARISTO} puuttuu GitHubin salaisuuksista)")
        if kelpaa:
            _kirjoita(polku, vanha)
            return {"tila": "vanha", "luotu": vanha["luotu"], "viesti": "ei avainta"}
        return {"tila": "ei avainta"}
    try:
        kaikki, tilasto = hae_kaikki(avain, loki, hae, tauko)
        sis = rakenna(kaikki, alue, nyt, tilasto)
        _kirjoita(polku, sis)
        loki(f"vesialueet: kirjoitettu {polku}, {os.path.getsize(polku) // 1024} kt; "
             f"{', '.join(sis['tunnukset']) or 'ei yleistä vesialuetta alueella'}; {sis['tilasto']}")
        return {"tila": "ok", "luotu": sis["luotu"], "maara": len(sis["tunnukset"])}
    except Exception as e:  # noqa: BLE001
        virhe = peita(str(e), avain)[:300]
        loki(f"vesialueet: VIRHE {virhe}")
        if kelpaa:
            _kirjoita(polku, vanha)
            return {"tila": "vanha", "luotu": vanha["luotu"], "viesti": virhe}
        return {"tila": "virhe", "viesti": virhe}


if __name__ == "__main__":   # käsin: MML_API_KEY=… python hae_vesialueet.py kansio
    print(paivita(sys.argv[1] if len(sys.argv) > 1 else ".", "https://lohirosvo.github.io/merilohitutka/data/",
                  alue={"lat_min": 63.45, "lat_max": 64.13, "lon_min": 22.05, "lon_max": 23.65}))
