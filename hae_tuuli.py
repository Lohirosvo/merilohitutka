"""Merilohitutka – hae_tuuli.py (v13: pisteet alueittain)

Hakee Ilmatieteen laitoksen toimitetun ennusteen (fmi::forecast::edited::weather::scandinavia::point::simple)
tuulen kiinteisiin pisteisiin merellä, 3 h välein koko Copernicus-jakson ajalle. Kartalle tuulinuolet.

Lähde: Ilmatieteen laitos, avoin data (CC BY 4.0). Sama kysely kuin sovelluksen paluuikkunassa (fmi.js),
joten puuskaparametri HourlyMaximumGust on todettu toimivaksi 9.11.2026.
Ennusteen todellinen pituus tulostuu lokiin (ei tarkistettu ennen ensimmäistä ajoa).
"""
import math
import re
import urllib.parse
import urllib.request

FMI = "https://opendata.fmi.fi/wfs"
KYSELY = "fmi::forecast::edited::weather::scandinavia::point::simple"
PARAMETRIT = ["WindSpeedMS", "WindDirection", "HourlyMaximumGust"]
# Pisteet merellä (lat, lon): Uusikaarlepyyn edustalta Tankarin pohjoispuolelle. Valittu kartalta silmämääräisesti.
PISTEET = [(63.55, 22.15), (63.55, 22.32), (63.55, 22.47),
           (63.70, 22.15), (63.70, 22.32), (63.70, 22.48),
           (63.85, 22.15), (63.85, 22.35), (63.85, 22.55),
           (64.00, 22.20), (64.00, 22.45), (64.00, 22.70), (64.00, 22.95)]
OTSAKE = {"User-Agent": "merilohitutka/9 (github.com/Lohirosvo/merilohitutka)"}


def _tagi(teksti, nimi):
    m = re.search(r"<(?:\w+:)?" + nimi + r"\b[^>]*>([\s\S]*?)</(?:\w+:)?" + nimi + ">", teksti)
    return m.group(1).strip() if m else None


def jasenna(xml):
    """simple-muoto -> [(lat, lon, aika_iso, parametri, arvo)]"""
    if "ExceptionReport" in xml[:3000]:
        raise ValueError("FMI: " + re.sub(r"\s+", " ", (_tagi(xml, "ExceptionText") or "virhe"))[:200])
    out = []
    for m in re.finditer(r"<(?:\w+:)?BsWfsElement\b[\s\S]*?</(?:\w+:)?BsWfsElement>", xml):
        el = m.group(0)
        pos = (_tagi(el, "pos") or "").split()
        aika, param, arvo = _tagi(el, "Time"), _tagi(el, "ParameterName"), _tagi(el, "ParameterValue")
        if len(pos) < 2 or not aika or not param:
            continue
        try:
            v = float(arvo)
        except (TypeError, ValueError):
            v = float("nan")
        out.append((float(pos[0]), float(pos[1]), aika, param, v))
    return out


def _pyynto(parametrit):
    url = FMI + "?" + urllib.parse.urlencode(parametrit)
    with urllib.request.urlopen(urllib.request.Request(url, headers=OTSAKE), timeout=90) as r:
        return r.read().decode("utf-8", "replace")


def _lahin(pisteet, lat, lon):
    return min(range(len(pisteet)), key=lambda i: (pisteet[i][0] - lat) ** 2 + ((pisteet[i][1] - lon) * 0.44) ** 2)


def rakenna(rivit, pisteet):
    """Rivit -> {ajat, ws[aika][piste], wd, wg} (puuttuva = None)."""
    ajat = sorted({r[2] for r in rivit})
    ia = {a: i for i, a in enumerate(ajat)}
    taulu = {p: [[None] * len(pisteet) for _ in ajat] for p in ("ws", "wd", "wg")}
    nimi = {"WindSpeedMS": "ws", "WindDirection": "wd", "HourlyMaximumGust": "wg", "WindGust": "wg"}
    for lat, lon, aika, param, v in rivit:
        if param not in nimi or v != v:   # NaN
            continue
        taulu[nimi[param]][ia[aika]][_lahin(pisteet, lat, lon)] = round(v, 1) if param != "WindDirection" else round(v)
    return {"ajat": ajat, **taulu}


def meripisteet(lat, lon, meri, tavoite=12):
    """Ennustepisteet mallin meriruuduista tasaisena hilana. meri[i][j] = True, jos ruutu on merta.
    Reunimmaiset rivit ja sarakkeet jätetään pois. Palauttaa [(lat, lon), ...]."""
    ni, nj = len(lat), len(lon)
    for askel in range(max(ni, nj) // 3, 0, -1):
        pts = [(round(float(lat[i]), 3), round(float(lon[j]), 3))
               for i in range(askel // 2 + 1, ni - 1, askel) for j in range(askel // 2 + 1, nj - 1, askel) if meri[i][j]]
        if len(pts) >= tavoite or askel == 1:
            if len(pts) > tavoite * 2:
                pts = pts[::max(1, len(pts) // (tavoite * 2))]
            return pts
    return []


def taydenna(kiinteat, ehdokkaat, min_km=10.0):
    """Kiinteät pisteet + ne ehdokkaat (mallin meriruuduista), jotka ovat yli min_km:n päässä jokaisesta kiinteästä
    ja jo lisätystä pisteestä (v22: Luodon alue laajeni Lohtajalle). Palauttaa uuden listan [(lat, lon), ...]."""
    tulos = [tuple(p) for p in kiinteat]
    def km(a, b):
        return math.hypot((a[0] - b[0]) * 111.32, (a[1] - b[1]) * 111.32 * math.cos(math.radians(a[0])))
    for e in ehdokkaat:
        if all(km(e, p) > min_km for p in tulos):
            tulos.append(tuple(e))
    return tulos


def hae(alku_iso, loppu_iso, loki=print, pyynto=None, pisteet=None):
    """Palauttaa (tulos, None) tai (None, virhe). tulos = {pisteet, ajat, ws, wd, wg, lahde}."""
    pyynto = pyynto or _pyynto
    PISTEET = [tuple(p) for p in (pisteet or globals()["PISTEET"])]
    perus = {"service": "WFS", "version": "2.0.0", "request": "getFeature", "storedquery_id": KYSELY,
             "parameters": ",".join(PARAMETRIT), "starttime": alku_iso, "endtime": loppu_iso, "timestep": "180"}
    rivit, virhe = [], None
    try:   # ensin kaikki pisteet yhdellä kyselyllä
        p = dict(perus, latlons=",".join(f"{la},{lo}" for la, lo in PISTEET))
        rivit = jasenna(pyynto(p))
        loydetyt = {(round(r[0], 2), round(r[1], 2)) for r in rivit}
        if len(loydetyt) < len(PISTEET) // 2:
            loki(f"tuuli: latlons palautti {len(loydetyt)} pistettä – haetaan piste kerrallaan")
            rivit = []
    except Exception as e:  # noqa: BLE001
        loki(f"tuuli: latlons-kysely ei onnistunut ({e}) – haetaan piste kerrallaan")
        rivit = []
    if not rivit:
        for la, lo in PISTEET:
            try:
                rivit += jasenna(pyynto(dict(perus, latlon=f"{la},{lo}")))
            except Exception as e:  # noqa: BLE001
                virhe = str(e)[:200]
                loki(f"tuuli: piste {la},{lo} epäonnistui: {virhe}")
    if not rivit:
        return None, virhe or "ei dataa"
    t = rakenna(rivit, PISTEET)
    puuskia = sum(1 for rivi in t["wg"] for v in rivi if v is not None)
    loki(f"tuuli: {len(t['ajat'])} aikaa ({t['ajat'][0]} … {t['ajat'][-1]}), {len(PISTEET)} pistettä, puuskia {puuskia}")
    t["pisteet"] = [list(p) for p in PISTEET]
    t["lahde"] = "Ilmatieteen laitos, toimitettu ennuste (avoin data, CC BY 4.0)"
    return t, None
