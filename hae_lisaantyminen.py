"""Merilohitutka – hae_lisaantyminen.py (v64, 21.11.2026)

Hannu 21.11.2026: "7 8 10 myös muikku silakka ahven taimen jos löytyy" → kohta 10: kalojen lisääntymisalueet.

Lähde [L, Luke / opendata.luke.fi, research.fi 21.11.2026]: "The larval observations and modelled larval production areas
of coastal fish species / VELMU" (Meri Kallasvuo, Luke 2019; CC BY 4.0). Toukkahavainnot 2007–2014 VELMU-ohjelmassa,
poikastuotantoalueet mallinnettu lajien levinneisyysmalleilla; "not suitable for local larval production estimates".
WMS https://kartta.luke.fi/geoserver/velmu/wms, EPSG:3067; tasojen nimiä esimerkeistä: velmu:velmu_kuha, velmu:velmu_muikku,
velmu:velmu_siika [L]. Silakan ja ahvenen tason nimeä ei nähty → haetaan GetCapabilitiesista nimen tai otsikon mukaan.
Taimenta ei ole aineistossa (meritaimen kutee joissa).

Mitä tehdään: alueen rajoille GetMap (EPSG:3857, sama projektio kuin kartta) PNG-kuvana lajia kohden ja selite
(GetLegendGraphic JSON, varalla PNG). Kuvat ja lisaantyminen.json alueen kansioon. Aineisto ei muutu (2019) → edellinen
käytetään 365 vrk, jos alue ja versio samat (kuvat haetaan julkaistulta sivulta takaisin).
"""
import json
import math
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone

WMS = "https://kartta.luke.fi/geoserver/velmu/wms"
OTSAKE = {"User-Agent": "merilohitutka/64 (github.com/Lohirosvo/merilohitutka; kerran vuodessa)"}
VERSIO = 1
UUSINTA_VRK = 365
LEVEYS = 1024   # kuvan leveys px (korkeus suhteessa); alue ~80 km → ~80 m/px
# (laji, nimi, tunnistus tason nimestä tai otsikosta, kielletyt osat)
LAJIT = [("silakka", "Silakan poikastuotantoalueet", r"silakka|herring|strömming", r"havainn|piste|obs"),
         ("muikku", "Muikun poikastuotantoalueet", r"muikku|vendace|siklöja", r"havainn|piste|obs"),
         ("ahven", "Ahvenen poikastuotantoalueet", r"ahven|perch|abborre", r"havainn|piste|obs|kuha|pike")]
LAHDE = "Luke, VELMU: toukkahavainnot ja mallinnetut poikastuotantoalueet (Kallasvuo 2019), CC BY 4.0"


def _hae(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=OTSAKE), timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")


def merkator(lat, lon):
    x = lon * 20037508.342789244 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137.0
    return x, y


def tasot(capabilities):
    """GetCapabilities-XML → [(nimi, otsikko)] (vain Layer-elementit, joilla Name)."""
    t = capabilities.decode("utf-8", "replace") if isinstance(capabilities, bytes) else capabilities
    out = []
    for m in re.finditer(r"<Layer\b[^>]*>\s*<Name>([^<]+)</Name>\s*<Title>([^<]*)</Title>", t):
        out.append((m.group(1).strip(), m.group(2).strip()))
    return out


def valitse_tasot(lista):
    """Lajille paras taso: nimessä/otsikossa lajin sana, ei havaintopisteitä; useasta lyhin nimi."""
    valitut = {}
    for laji, _, hyva, huono in LAJIT:
        ehd = [(n, o) for n, o in lista if re.search(hyva, n + " " + o, re.I) and not re.search(huono, n, re.I)]   # kielto vain nimeen
        if ehd:
            valitut[laji] = sorted(ehd, key=lambda x: len(x[0]))[0]
    return valitut


def selite_jsonista(data):
    """GeoServer GetLegendGraphic JSON → [{nimi, vari}] (polygon/raster-säännöt)."""
    try:
        j = json.loads(data.decode("utf-8") if isinstance(data, bytes) else data)
    except Exception:  # noqa: BLE001
        return []
    out = []
    for leg in j.get("Legend", []):
        for r in leg.get("rules", []):
            nimi = r.get("title") or r.get("name") or ""
            for s in r.get("symbolizers", []):
                for tyyppi in ("Polygon", "Point", "Line"):
                    if tyyppi in s:
                        v = s[tyyppi].get("fill") or s[tyyppi].get("stroke")
                        if v:
                            out.append({"nimi": nimi, "vari": v})
                if "Raster" in s:
                    for e in (s["Raster"].get("colormap") or {}).get("entries", []):
                        if e.get("color"):
                            out.append({"nimi": e.get("label") or str(e.get("quantity", "")), "vari": e["color"],
                                        "laatu": e.get("quantity")})
    return out


def on_png(data):
    return isinstance(data, (bytes, bytearray)) and data[:8] == b"\x89PNG\r\n\x1a\n"


def paivita(kansio, sivun_osoite, loki=print, alue=None, hae=_hae, nyt=None):
    """Kirjoittaa kansio/lisaantyminen.json ja lis_<laji>.png. Palauttaa tilan meri.json:iin."""
    nyt = nyt or datetime.now(timezone.utc)
    polku = os.path.join(kansio, "lisaantyminen.json")
    vanha = None
    try:
        vanha = json.loads(hae(sivun_osoite + "lisaantyminen.json")[0].decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        loki(f"lisääntymisalueet: edellistä ei saatu ({e})")
    if vanha and vanha.get("versio") == VERSIO and vanha.get("alue") == alue and vanha.get("lajit"):
        try:
            ika = (nyt - datetime.strptime(vanha["luotu"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)).days
        except Exception:  # noqa: BLE001
            ika = 999
        if ika < UUSINTA_VRK:
            try:   # kuvat takaisin julkaistulta sivulta
                for L in vanha["lajit"]:
                    d = hae(sivun_osoite + L["tiedosto"])[0]
                    if not on_png(d):
                        raise ValueError(f"{L['tiedosto']} ei ole PNG")
                    with open(os.path.join(kansio, L["tiedosto"]), "wb") as f:
                        f.write(d)
                with open(polku, "w", encoding="utf-8") as f:
                    json.dump(vanha, f, ensure_ascii=False)
                loki(f"lisääntymisalueet: käytetään edellistä ({ika} vrk)")
                return {"tila": "ok", "luotu": vanha["luotu"]}
            except Exception as e:  # noqa: BLE001
                loki(f"lisääntymisalueet: edellisen kuvat puuttuvat ({e}) – haetaan uudelleen")
    cap = hae(WMS + "?service=WMS&version=1.3.0&request=GetCapabilities", 90)[0]
    lista = tasot(cap)
    loki(f"lisääntymisalueet: {len(lista)} tasoa: " + ", ".join(n for n, _ in lista)[:600])
    valitut = valitse_tasot(lista)
    if not valitut:
        raise ValueError("VELMU-palvelusta ei löytynyt silakan, muikun eikä ahvenen tasoa")
    x0, y0 = merkator(alue["lat_min"], alue["lon_min"])
    x1, y1 = merkator(alue["lat_max"], alue["lon_max"])
    kork = max(64, round(LEVEYS * (y1 - y0) / (x1 - x0)))
    bbox = [round(v, 1) for v in (x0, y0, x1, y1)]
    lajit, virheet = [], []
    for laji, nimi, _, _ in LAJIT:
        if laji not in valitut:
            virheet.append(f"{laji}: tasoa ei löytynyt")
            continue
        taso = valitut[laji][0]
        q = urllib.parse.urlencode({"service": "WMS", "version": "1.3.0", "request": "GetMap", "layers": taso, "styles": "",
                                    "crs": "EPSG:3857", "bbox": ",".join(map(str, bbox)), "width": LEVEYS, "height": kork,
                                    "format": "image/png", "transparent": "true"})
        try:
            d, tyyppi = hae(WMS + "?" + q, 120)
            if not on_png(d):
                raise ValueError(f"ei PNG ({tyyppi}): {d[:150]!r}")
            tiedosto = f"lis_{laji}.png"
            with open(os.path.join(kansio, tiedosto), "wb") as f:
                f.write(d)
            selite = []
            try:
                lq = urllib.parse.urlencode({"service": "WMS", "version": "1.3.0", "request": "GetLegendGraphic",
                                             "layer": taso, "format": "application/json"})
                selite = selite_jsonista(hae(WMS + "?" + lq, 60)[0])
            except Exception as e:  # noqa: BLE001
                loki(f"lisääntymisalueet {laji}: selitettä ei saatu ({e})")
            lajit.append({"laji": laji, "nimi": nimi, "taso": taso, "otsikko": valitut[laji][1], "tiedosto": tiedosto,
                          "bbox3857": bbox, "leveys": LEVEYS, "korkeus": kork, "koko": len(d), "selite": selite})
            loki(f"lisääntymisalueet {laji}: {taso} ({valitut[laji][1]}), {len(d) // 1024} kt, selite {len(selite)} luokkaa")
        except Exception as e:  # noqa: BLE001
            virheet.append(f"{laji}: {str(e)[:200]}")
            loki(f"lisääntymisalueet {laji}: VIRHE {e}")
    if not lajit:
        raise ValueError("; ".join(virheet))
    sis = {"versio": VERSIO, "luotu": nyt.strftime("%Y-%m-%dT%H:%M:%SZ"), "alue": alue, "lahde": LAHDE, "wms": WMS,
           "lajit": lajit, "virheet": virheet}
    with open(polku, "w", encoding="utf-8") as f:
        json.dump(sis, f, ensure_ascii=False)
    return {"tila": "ok" if not virheet else "osittain", "luotu": sis["luotu"]}
