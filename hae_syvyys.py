"""Merilohitutka – hae_syvyys.py (v13: alue parametrina)

Hakee Traficomin merikartan syvyyskäyrät (aineisto "Merikartan syvyystiedot") WFS-rajapinnasta
Uusikaarlepyy–Tankar-alueelta ja kirjoittaa ne sovellukselle tiedostoon data/syvyys.json.

Lähde: Liikenne- ja viestintävirasto Traficom. Ei navigointikäyttöön. Ei täytä virallisen merikartan vaatimuksia.

Syvyyskäyrät muuttuvat harvoin: jos julkaistulla sivulla on alle 30 vrk vanha syvyys.json, se
käytetään sellaisenaan eikä Traficomin rajapintaa kuormiteta. Epäonnistuminen ei koskaan kaada
Copernicus-hakua: virhe kirjataan lokiin ja vanha tiedosto säilyy, jos sellainen on.

Rajapintaa ei voitu testata ennen ensimmäistä ajoa, joten haku on varovainen ja tulostaa lokiin
tasojen nimet, ominaisuuksien nimet ja vastauksen alun, jos jokin ei täsmää.
"""
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ALUE = dict(lat_min=63.45, lat_max=64.05, lon_min=22.05, lon_max=23.10)
WFS = ["https://julkinen.traficom.fi/inspirepalvelu/rajoitettu/wfs",
       "https://julkinen.traficom.fi/inspirepalvelu/avoin/wfs"]
TASON_AVAIMET = ["syvyyskayra", "syvyyskäyrä", "depcnt", "depth_contour", "depthcontour"]
SYVYYS_KENTAT = ["valdco", "syvyys", "syvyysarvo", "depth", "arvo", "value", "val"]
SIVU = 2000              # kohteita per pyyntö
MAX_SIVUT = 300
VERSIO = 3               # v12: sivut pysyvässä järjestyksessä (v11:ssä 1134/3984 käyrää jäi saamatta) -> vanha haetaan uudelleen
TOLERANSSI_M = 6.0       # yksinkertaistus (Douglas–Peucker), metriä
KERROIN = 100000         # koordinaatit 1e-5 asteen kokonaislukuina
UUSINTA_VRK = 30
OTSAKE = {"User-Agent": "merilohitutka/8 (github.com/Lohirosvo/merilohitutka; kerran kuussa)"}
LAHDE = "Liikenne- ja viestintävirasto Traficom, Merikartan syvyystiedot (syvyyskäyrät)"
HUOM = "Ei navigointikäyttöön. Ei täytä virallisen merikartan vaatimuksia."


# ---------------------------------------------------------------- ETRS-TM35FIN (EPSG:3067) <-> WGS84/ETRS89
# JHS 154 -kaavat (Krügerin sarjat), GRS80.
_A, _F = 6378137.0, 1 / 298.257222101
_K0, _LON0, _E0 = 0.9996, math.radians(27.0), 500000.0
_N = _F / (2 - _F)
_A1 = _A / (1 + _N) * (1 + _N ** 2 / 4 + _N ** 4 / 64)
_E = math.sqrt(_F * (2 - _F))
_H = [_N / 2 - 2 / 3 * _N ** 2 + 5 / 16 * _N ** 3 + 41 / 180 * _N ** 4,
      13 / 48 * _N ** 2 - 3 / 5 * _N ** 3 + 557 / 1440 * _N ** 4,
      61 / 240 * _N ** 3 - 103 / 140 * _N ** 4,
      49561 / 161280 * _N ** 4]
_HI = [_N / 2 - 2 / 3 * _N ** 2 + 37 / 96 * _N ** 3 - 1 / 360 * _N ** 4,
       1 / 48 * _N ** 2 + 1 / 15 * _N ** 3 - 437 / 1440 * _N ** 4,
       17 / 480 * _N ** 3 - 37 / 840 * _N ** 4,
       4397 / 161280 * _N ** 4]


def tm35(lat, lon):
    """(lat, lon) asteina -> (E, N) metreinä."""
    fi, la = math.radians(lat), math.radians(lon)
    q = math.asinh(math.tan(fi)) - _E * math.atanh(_E * math.sin(fi))
    beta = math.atan(math.sinh(q))
    eta0 = math.atanh(math.cos(beta) * math.sin(la - _LON0))
    xi0 = math.asin(math.sin(beta) * math.cosh(eta0))
    xi, eta = xi0, eta0
    for i, h in enumerate(_H, 1):
        xi += h * math.sin(2 * i * xi0) * math.cosh(2 * i * eta0)
        eta += h * math.cos(2 * i * xi0) * math.sinh(2 * i * eta0)
    return _A1 * eta * _K0 + _E0, _A1 * xi * _K0


def tm35_latlon(e, n):
    """(E, N) metreinä -> (lat, lon) asteina."""
    xi, eta = n / (_A1 * _K0), (e - _E0) / (_A1 * _K0)
    xi0, eta0 = xi, eta
    for i, h in enumerate(_HI, 1):
        xi0 -= h * math.sin(2 * i * xi) * math.cosh(2 * i * eta)
        eta0 -= h * math.cos(2 * i * xi) * math.sinh(2 * i * eta)
    beta = math.asin(math.sin(xi0) / math.cosh(eta0))
    la = _LON0 + math.asin(math.tanh(eta0) / math.cos(beta))
    q = math.asinh(math.tan(beta))
    q2 = q + _E * math.atanh(_E * math.tanh(q))
    for _ in range(6):
        q2 = q + _E * math.atanh(_E * math.tanh(q2))
    return math.degrees(math.atan(math.sinh(q2))), math.degrees(la)


# ---------------------------------------------------------------- koordinaattien tulkinta
def tulkitse_jarjestys(a, b):
    """Palauttaa 'latlon', 'lonlat' tai 'tm35' ensimmäisen pisteen perusteella (alueen arvovälit eivät mene päällekkäin)."""
    if a > 1000 and b > 1000:
        return "tm35"
    if 55 < a < 72 and 15 < b < 35:
        return "latlon"
    if 55 < b < 72 and 15 < a < 35:
        return "lonlat"
    raise ValueError(f"tuntematon koordinaattijärjestys: {a}, {b}")


def muunna(pisteet, jarjestys):
    """[(a, b), ...] -> [(lat, lon), ...]"""
    if jarjestys == "latlon":
        return [(a, b) for a, b in pisteet]
    if jarjestys == "lonlat":
        return [(b, a) for a, b in pisteet]
    return [tm35_latlon(a, b) for a, b in pisteet]


# ---------------------------------------------------------------- yksinkertaistus ja koodaus
def yksinkertaista(pts, tol_m=TOLERANSSI_M):
    """Douglas–Peucker paikallisessa metrikoordinaatistossa. pts = [(lat, lon), ...]"""
    if len(pts) < 3:
        return list(pts)
    lat0 = math.radians(pts[0][0])
    xy = [(lon * 111320.0 * math.cos(lat0), lat * 110574.0) for lat, lon in pts]
    pidetaan = [False] * len(pts)
    pidetaan[0] = pidetaan[-1] = True
    pino = [(0, len(pts) - 1)]
    while pino:
        i, j = pino.pop()
        (x1, y1), (x2, y2) = xy[i], xy[j]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        paras, pk = -1.0, -1
        for k in range(i + 1, j):
            px, py = xy[k]
            if L2 == 0:
                d = math.hypot(px - x1, py - y1)
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
                d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
            if d > paras:
                paras, pk = d, k
        if paras > tol_m:
            pidetaan[pk] = True
            pino.append((i, pk))
            pino.append((pk, j))
    return [p for p, k in zip(pts, pidetaan) if k]


def koodaa(pts, origo):
    """[(lat, lon)] -> [x0, y0, dx1, dy1, ...] kokonaislukuina (x = lon, y = lat; 1e-5 astetta, delta)."""
    out, px, py = [], None, None
    for lat, lon in pts:
        x, y = round((lon - origo[1]) * KERROIN), round((lat - origo[0]) * KERROIN)
        if px is None:
            out += [x, y]
        else:
            if x == px and y == py:
                continue
            out += [x - px, y - py]
        px, py = x, y
    return out


def syvyysarvo(ominaisuudet, kentat=None):
    """Syvyys kohteen ominaisuuksista: ensin tunnetut nimet, sitten ainoa järkevä luku."""
    pienet = {str(k).lower(): v for k, v in ominaisuudet.items()}
    for k in (kentat or SYVYYS_KENTAT):
        if k in pienet:
            try:
                return float(str(pienet[k]).replace(",", "."))
            except (TypeError, ValueError):
                pass
    luvut = []
    for k, v in pienet.items():
        if "id" in k:
            continue
        try:
            f = float(str(v).replace(",", "."))
            if 0 <= f <= 400:
                luvut.append(f)
        except (TypeError, ValueError):
            pass
    return luvut[0] if len(luvut) == 1 else None


def origo_alueelle(alue=None):
    a = alue or ALUE
    return (math.floor(a["lat_min"] * 10) / 10, math.floor(a["lon_min"] * 10) / 10)


def rakenna(viivat_syvyyksittain, luotu, taso, alue=None):
    """{syvyys: [[(lat, lon), ...], ...]} -> syvyys.json-sisältö."""
    origo = origo_alueelle(alue)
    kayrat, pisteita = {}, 0
    for syv in sorted(viivat_syvyyksittain):
        lista = []
        for viiva in viivat_syvyyksittain[syv]:
            y = yksinkertaista(viiva)
            if len(y) >= 2:
                k = koodaa(y, origo)
                if len(k) >= 4:
                    lista.append(k)
                    pisteita += len(k) // 2
        if lista:
            kayrat[(f"{syv:g}")] = lista
    return {"muoto": 1, "versio": VERSIO, "luotu": luotu, "lahde": LAHDE, "huom": HUOM, "taso": taso, "alue": alue or ALUE,
            "lisenssi": "Traficomin avoin data (CC BY 4.0 / hydrografisen aineiston lisenssi), "
                        "https://www.traficom.fi/en/transport-system/geoinformationsmaterial/use-and-licences-data",
            "origo": list(origo), "kerroin": KERROIN, "pisteita": pisteita, "kayrat": kayrat}


# ---------------------------------------------------------------- WFS
def _hae(osoite, parametrit, aikakatkaisu=120):
    url = osoite + "?" + urllib.parse.urlencode(parametrit)
    with urllib.request.urlopen(urllib.request.Request(url, headers=OTSAKE), timeout=aikakatkaisu) as r:
        return r.read(), r.headers.get("Content-Type", "")


def _paikallinen(tag):
    return tag.rsplit("}", 1)[-1]


def tasot_kyvyista(xml_teksti):
    """GetCapabilities -> (versio, [tason nimet], [tulostusmuodot])"""
    juuri = ET.fromstring(xml_teksti)
    versio = juuri.attrib.get("version", "2.0.0")
    nimet, muodot = [], set()
    for el in juuri.iter():
        nimi = _paikallinen(el.tag)
        if nimi == "FeatureType":
            for c in el:
                if _paikallinen(c.tag) == "Name" and c.text:
                    nimet.append(c.text.strip())
        elif nimi in ("Format", "Value") and el.text and ("json" in el.text.lower() or "gml" in el.text.lower()):
            muodot.add(el.text.strip())
    return versio, nimet, sorted(muodot)


def valitse_taso(nimet):
    for n in nimet:
        pieni = n.lower()
        if any(a in pieni for a in TASON_AVAIMET):
            return n
    return None


def jasenna_geojson(data, kentat=None):
    """GeoJSON -> [(syvyys, [[(a, b), ...], ...], ominaisuudet)]. Alueiden reunat palautetaan viivoina."""
    out = []
    for f in data.get("features", []):
        g = f.get("geometry") or {}
        ominaisuudet = f.get("properties") or {}
        t, c = g.get("type"), g.get("coordinates", [])
        if t == "LineString":
            osat = [c]
        elif t in ("MultiLineString", "Polygon"):
            osat = c
        elif t == "MultiPolygon":
            osat = [rengas for monikulmio in c for rengas in monikulmio]
        else:
            continue
        osat = [[(float(p[0]), float(p[1])) for p in o if len(p) >= 2] for o in osat]
        out.append((syvyysarvo(ominaisuudet, kentat), osat, ominaisuudet))
    return out


def jasenna_gml(xml_teksti, kentat=None):
    """GML (2/3) -> sama muoto kuin jasenna_geojson. Ominaisuudet = kohteen lapsielementit, joissa pelkkä teksti."""
    juuri = ET.fromstring(xml_teksti)
    out = []
    for jasen in juuri.iter():
        if _paikallinen(jasen.tag) not in ("member", "featureMember", "featureMembers"):
            continue
        kohteet = list(jasen)
        for kohde in kohteet:
            ominaisuudet, osat = {}, []
            for c in kohde:
                if len(c) == 0 and c.text and c.text.strip():
                    ominaisuudet[_paikallinen(c.tag)] = c.text.strip()
            for el in kohde.iter():
                n = _paikallinen(el.tag)
                if n == "posList" and el.text:
                    v = [float(x) for x in el.text.split()]
                    osat.append(list(zip(v[0::2], v[1::2])))
                elif n == "coordinates" and el.text:
                    pts = [tuple(float(x) for x in p.split(",")[:2]) for p in el.text.split()]
                    osat.append(pts)
            if osat:
                out.append((syvyysarvo(ominaisuudet, kentat), osat, ominaisuudet))
    return out


def bbox_vaihtoehdot(alue=None):
    a = alue or ALUE
    kulmat = [tm35(la, lo) for la in (a["lat_min"], a["lat_max"]) for lo in (a["lon_min"], a["lon_max"])]
    emin, emax = min(k[0] for k in kulmat) - 1000, max(k[0] for k in kulmat) + 1000
    nmin, nmax = min(k[1] for k in kulmat) - 1000, max(k[1] for k in kulmat) + 1000
    return [f"{a['lat_min']},{a['lon_min']},{a['lat_max']},{a['lon_max']},urn:ogc:def:crs:EPSG::4326",
            f"{a['lon_min']},{a['lat_min']},{a['lon_max']},{a['lat_max']},EPSG:4326",
            f"{emin:.0f},{nmin:.0f},{emax:.0f},{nmax:.0f},EPSG:3067"]


def _uniikit(kohteet):
    """Poistaa kaksoiskappaleet (sama syvyys, osien määrä, ensimmäisen osan alku, loppu ja pituus)."""
    nahty, out = set(), []
    for k in kohteet:
        o = k[1][0] if k[1] else []
        tunnus = (k[0], tuple(o[0]) if o else None, tuple(o[-1]) if o else None, len(o), len(k[1]))
        if tunnus not in nahty:
            nahty.add(tunnus)
            out.append(k)
    return out


def _jarjestysavain(kohteet):
    """Ominaisuus, jolla sivut saadaan pysyvään järjestykseen (esim. Traficomin IDENTIFIER)."""
    ominaisuudet = kohteet[0][2] if kohteet else {}
    for k in ["IDENTIFIER", "identifier", "id", "gid", "fid", "objectid", "OBJECTID"]:
        if k in ominaisuudet:
            return k
    for k in ominaisuudet:
        if str(k).lower().endswith("id"):
            return k
    return None


def _getfeature(osoite, versio, taso, bbox, muoto, kentat, maara, alku=0, jarjestys=None):
    """Yksi GetFeature-pyyntö -> (kohteet, palvelimen ilmoittama kokonaismäärä tai None)."""
    v2 = versio.startswith("2")
    p = {"service": "WFS", "version": versio, "request": "GetFeature", "bbox": bbox,
         ("typeNames" if v2 else "typeName"): taso, ("count" if v2 else "maxFeatures"): maara}
    if alku:
        p["startIndex"] = alku
    if jarjestys:
        p["sortBy"] = f"{jarjestys} {'ASC' if v2 else 'A'}"
    if muoto:
        p["outputFormat"] = muoto
    if "3067" not in bbox:
        p["srsName"] = "EPSG:4326"
    sisalto, tyyppi = _hae(osoite, p)
    teksti = sisalto.decode("utf-8", "replace")
    try:
        if teksti.lstrip().startswith("{"):
            data = json.loads(teksti)
            ilm = data.get("numberMatched", data.get("totalFeatures"))
            return jasenna_geojson(data, kentat), (ilm if isinstance(ilm, int) else None)
        if "ExceptionReport" in teksti[:2000] or "ServiceException" in teksti[:2000]:
            raise ValueError("palvelimen virhe: " + re.sub(r"\s+", " ", teksti[:400]))
        m = re.search(r'numberMatched="(\d+)"', teksti[:3000])
        return jasenna_gml(teksti, kentat), (int(m.group(1)) if m else None)
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"vastausta ei voitu jäsentää ({tyyppi}): {e}; alku: {teksti[:300]!r}")


def _sivuttain(hae, ilmoitettu, sivu, loki):
    """Sivut järjestyksessä. hae(alku, maara) -> (kohteet, _). Lopetus tyhjään sivuun tai ilmoitettuun määrään."""
    kaikki, alku, eka = [], 0, None
    for _ in range(MAX_SIVUT):
        kohteet, _ = hae(alku, sivu)
        if not kohteet:
            break
        tunniste = (kohteet[0][0], tuple(kohteet[0][1][0][:2]) if kohteet[0][1] and kohteet[0][1][0] else None)
        if alku and tunniste == eka:
            loki("  palvelin ei tue sivutusta (sama sivu toistui)")
            break
        eka = eka or tunniste
        kaikki += kohteet
        alku += len(kohteet)
        if isinstance(ilmoitettu, int) and alku >= ilmoitettu:
            break
    return kaikki


def hae_kohteet(osoite, versio, taso, muodot, loki, kentat=None, alue=None):
    """Kaikki alueen kohteet. v11-lokin mukaan Traficomin palvelin palauttaa sivut ilman järjestystä
    eri järjestyksessä (3984 kohteesta 1134 tuli kahdesti, yhtä monta jäi saamatta). Siksi:
    1) ensimmäinen pyyntö kertoo kokonaismäärän, 2) kaikki yhdellä pyynnöllä, jos palvelin sallii,
    3) muuten sivut pysyvässä järjestyksessä (sortBy), 4) tarkistus: uniikkien määrä = ilmoitettu."""
    json_muodot = [m for m in muodot if "json" in m.lower()] or ["application/json"]
    tulosmuodot = json_muodot[:1] + [None]   # None = palvelimen oletus (GML)
    for bbox in bbox_vaihtoehdot(alue):
        for muoto in tulosmuodot:
            nimi = f"muoto {muoto or 'GML'}, bbox {bbox.rsplit(',', 1)[-1]}"
            hae = lambda alku, maara, j=None: _getfeature(osoite, versio, taso, bbox, muoto, kentat, maara, alku, j)  # noqa: E731
            try:
                eka, ilm = hae(0, SIVU)
            except Exception as e:  # noqa: BLE001
                loki(f"  GetFeature epäonnistui ({nimi}): {e}")
                continue
            if not eka:
                continue
            kaikki, tapa = eka, "yksi sivu"
            # Lisää sivuja, jos palvelin ilmoitti enemmän – tai ei ilmoittanut määrää lainkaan (yläraja voi olla < SIVU).
            if (isinstance(ilm, int) and ilm > len(eka)) or ilm is None:
                kerralla = []
                if isinstance(ilm, int):
                    try:
                        kerralla, _ = hae(0, ilm + 10)
                    except Exception as e:  # noqa: BLE001
                        loki(f"  kaikki kerralla ei onnistunut: {e}")
                if isinstance(ilm, int) and len(_uniikit(kerralla)) >= ilm:
                    kaikki, tapa = kerralla, f"kaikki kerralla ({len(kerralla)})"
                else:
                    avain = _jarjestysavain(eka)
                    try:
                        if not avain:
                            raise ValueError("ei järjestysavainta")
                        kaikki = _sivuttain(lambda a, m: hae(a, m, avain), ilm, len(kerralla) or len(eka), loki)
                        tapa = f"sivuttain järjestettynä ({avain})"
                    except Exception as e:  # noqa: BLE001
                        loki(f"  järjestetty sivutus ei onnistunut ({e}) – sivutetaan ilman järjestystä")
                        kaikki = _sivuttain(hae, ilm, len(eka), loki)
                        tapa = "sivuttain ilman järjestystä"
            uniikit = _uniikit(kaikki)
            loki(f"  {len(uniikit)} kohdetta ({len(kaikki) - len(uniikit)} kaksoiskappaletta pois); palvelin ilmoitti "
                 f"{ilm}; ensimmäisen sivun koko {len(eka)}; tapa: {tapa} ({nimi})")
            if isinstance(ilm, int) and len(uniikit) < ilm:
                loki(f"  VAROITUS: saatiin {len(uniikit)} / {ilm} kohdetta – {ilm - len(uniikit)} puuttuu")
            return uniikit
    return []


def hae_traficomista(loki=print, alue=None):
    """Palauttaa (syvyys.json-sisältö, None) tai (None, virheteksti)."""
    virheet = []
    for osoite in WFS:
        try:
            xml_teksti, _ = _hae(osoite, {"service": "WFS", "request": "GetCapabilities"}, 60)
            versio, nimet, muodot = tasot_kyvyista(xml_teksti)
        except Exception as e:  # noqa: BLE001
            virheet.append(f"{osoite}: GetCapabilities {e}")
            loki(f"syvyys: {osoite} GetCapabilities epäonnistui: {e}")
            continue
        loki(f"syvyys: {osoite} WFS {versio}, {len(nimet)} tasoa: {', '.join(nimet)[:900]}")
        loki(f"  tulostusmuodot: {', '.join(muodot)[:300]}")
        taso = valitse_taso(nimet)
        if not taso:
            virheet.append(f"{osoite}: ei syvyyskäyrätasoa")
            continue
        loki(f"  syvyyskäyrätaso: {taso}")
        kohteet = hae_kohteet(osoite, versio, taso, muodot, loki, None, alue)
        if not kohteet:
            virheet.append(f"{osoite}: {taso}: ei kohteita")
            continue
        loki(f"  esimerkin ominaisuudet: {json.dumps(kohteet[0][2], ensure_ascii=False)[:400]}")
        ilman = sum(1 for k in kohteet if k[0] is None)
        if ilman == len(kohteet):
            virheet.append(f"{taso}: syvyysarvoa ei tunnistettu ominaisuuksista")
            continue
        a, b = next(p for k in kohteet for o in k[1] for p in o[:1])
        jarjestys = tulkitse_jarjestys(a, b)
        loki(f"  koordinaatit: {jarjestys}; kohteita ilman syvyyttä {ilman}")
        viivat = {}
        for syv, osat, _ in kohteet:
            if syv is None:
                continue
            for o in osat:
                if len(o) >= 2:
                    viivat.setdefault(syv, []).append(muunna(o, jarjestys))
        tulos = rakenna(viivat, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), taso, alue)
        loki(f"  syvyydet (m): {', '.join(tulos['kayrat'].keys())}; pisteitä yksinkertaistuksen jälkeen {tulos['pisteita']}")
        return tulos, None
    return None, " | ".join(virheet)[:500]


# ---------------------------------------------------------------- käyttö hae_copernicus.py:stä
def paivita(kansio, sivun_osoite, loki=print, alue=None):
    """Kirjoittaa kansio/syvyys.json. Palauttaa tilan meri.json:iin: {tila, luotu?, viesti?}."""
    polku = os.path.join(kansio, "syvyys.json")
    vanha = None
    try:
        with urllib.request.urlopen(urllib.request.Request(sivun_osoite + "syvyys.json", headers=OTSAKE), timeout=30) as r:
            vanha = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        loki(f"syvyys: edellistä syvyys.json:ia ei saatu ({e})")
    if vanha and "kayrat" in vanha and alue and vanha.get("alue") not in (None, alue):
        loki("syvyys: edellinen tiedosto on eri alueelta – haetaan uudelleen")
        vanha = None
    if vanha and "kayrat" in vanha and vanha.get("versio", 1) < VERSIO:
        loki(f"syvyys: edellinen tiedosto on vanhaa versiota ({vanha.get('versio', 1)}) – haetaan uudelleen")
        vanha_kaytettavissa = vanha   # varalle, jos uusi haku epäonnistuu
        vanha = None
    else:
        vanha_kaytettavissa = vanha
    if vanha and "kayrat" in vanha:
        try:
            ika = (datetime.now(timezone.utc) - datetime.strptime(vanha["luotu"], "%Y-%m-%dT%H:%M:%SZ")
                   .replace(tzinfo=timezone.utc)).days
        except Exception:  # noqa: BLE001
            ika = 999
        if ika < UUSINTA_VRK:
            with open(polku, "w", encoding="utf-8") as f:
                json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
            loki(f"syvyys: käytetään edellistä ({ika} vrk vanha)")
            return {"tila": "ok", "luotu": vanha["luotu"]}
    try:
        uusi, virhe = hae_traficomista(loki, alue)
    except Exception as e:  # noqa: BLE001
        uusi, virhe = None, f"odottamaton virhe: {e}"
    if uusi:
        with open(polku, "w", encoding="utf-8") as f:
            json.dump(uusi, f, ensure_ascii=False, separators=(",", ":"))
        loki(f"syvyys: kirjoitettu {polku}, {os.path.getsize(polku) // 1024} kt (pakkaamatta)")
        return {"tila": "ok", "luotu": uusi["luotu"]}
    loki(f"syvyys: VIRHE {virhe}")
    vanha = vanha_kaytettavissa
    if vanha and "kayrat" in vanha:
        with open(polku, "w", encoding="utf-8") as f:
            json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
        return {"tila": "vanha", "luotu": vanha["luotu"], "viesti": virhe}
    return {"tila": "virhe", "viesti": virhe}


if __name__ == "__main__":   # käsin: python hae_syvyys.py kansio
    print(paivita(sys.argv[1] if len(sys.argv) > 1 else ".", "https://lohirosvo.github.io/merilohitutka/data/"))
