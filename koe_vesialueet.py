"""Merilohitutka – koe_vesialueet.py (v68, 22.11.2026) – KOEAJO, ei karttaa eikä sovellusmuutosta.

Hannu 22.11.2026: "Valtion yleinen vesialue (ulappa) … Tällä alueella kalastonhoitomaksulla saa viehekalastaa ilman vapamäärän
rajoitusta. … Onko tehtävissä?" → "Tehdään koeajo".
[L eräluvat.fi] yleisillä vesialueilla "no restrictions on the maximum number of rods"; ne ovat aluemeren vesiä ja merkitty
peruskarttoihin. [L theseus.fi] kiinteistörekisterissä vesialueet ovat yleisiä, kiinteistöjen ja yhteisiä vesialueita.
Kysymys, johon koe vastaa: tunnistuuko yleinen vesialue Maanmittauslaitoksen avoimesta INSPIRE-kiinteistöaineistosta
(WFS, ei rekisteröitymistä [L avoindata.fi]) – kiinteistötunnuksen muoto, muut tiedot, palstan koko ja geometrian raskaus.

Mitä tehdään (kerran vuorokaudessa, enintään KOE_S sekuntia; virhe ei vaikuta muuhun hakuun):
 1. GetCapabilities: kohdetyypit, tulostusmuodot, koordinaatistot, suodattimet → lokiin.
 2. Koepisteet: alueittain poikkileikkaus lännestä itään alueen keskileveydellä (7 pistettä) + nimetyt pisteet
    (Kolmoispatti, lähtöpisteet). Jokaisesta pienestä ruudusta (~100 m) palstat: kiinteistötunnus, nimi/label, pinta-ala,
    kaikki ominaisuuksien nimet ja geometrian koko (pisteitä, renkaita, rajauslaatikko). Vastaus katkaistaan 8 Mt:hen.
 3. Tulos lokiin ja data/vesialue_koe.json (julkaistulle sivulle, josta Claude voi lukea sen).
Ei tallenna saalis- tai henkilötietoja; kiinteistötunnukset ovat julkista avointa dataa (CC BY 4.0).
"""
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

WFS = "https://inspire-wfs.maanmittauslaitos.fi/inspire-wfs/cp/ows"
OTSAKE = {"User-Agent": "merilohitutka/68 (github.com/Lohirosvo/merilohitutka; koeajo kerran vuorokaudessa)"}
MAX_TAVUT = 8 * 1024 * 1024
KOE_S = 240
PUOLI_M = 50.0
TIEDOSTO = "vesialue_koe.json"
VERSIO = 1


def _hae(url, timeout=60, max_tavut=MAX_TAVUT):
    """(tavut, katkaistu, content-type)."""
    with urllib.request.urlopen(urllib.request.Request(url, headers=OTSAKE), timeout=timeout) as r:
        d = r.read(max_tavut + 1)
        return d[:max_tavut], len(d) > max_tavut, r.headers.get("Content-Type", "")


def _pn(tag):
    return tag.rsplit("}", 1)[-1]


def kyvyt(xml):
    """GetCapabilities → {versio, tyypit: [{nimi, crs: [...]}], muodot, suodattimet, sivutus}."""
    juuri = ET.fromstring(xml)
    out = {"versio": juuri.attrib.get("version"), "tyypit": [], "muodot": set(), "suodattimet": set(), "sivutus": None}
    for el in juuri.iter():
        n = _pn(el.tag)
        if n == "FeatureType":
            t = {"nimi": None, "crs": []}
            for c in el:
                cn = _pn(c.tag)
                if cn == "Name" and c.text:
                    t["nimi"] = c.text.strip()
                elif cn in ("DefaultCRS", "OtherCRS", "DefaultSRS", "OtherSRS") and c.text:
                    t["crs"].append(c.text.strip())
            out["tyypit"].append(t)
        elif n in ("Format", "Value") and el.text and any(s in el.text.lower() for s in ("json", "gml", "xml")):
            out["muodot"].add(el.text.strip())
        elif n in ("ComparisonOperator", "SpatialOperator", "Constraint", "Operator", "ComparisonOperatorType"):
            nimi = el.attrib.get("name") or (el.text or "").strip()
            if nimi:
                out["suodattimet"].add(nimi)
            if nimi == "ImplementsResultPaging":
                arvo = "".join(x.text or "" for x in el.iter() if _pn(x.tag) == "DefaultValue").strip()
                out["sivutus"] = arvo or "?"
    out["muodot"] = sorted(out["muodot"])[:12]
    out["suodattimet"] = sorted(out["suodattimet"])[:40]
    return out


def valitse_tyyppi(tyypit, avain="cadastralparcel"):
    for t in tyypit:
        if t["nimi"] and avain in t["nimi"].lower().replace("_", ""):
            return t["nimi"]
    return None


def bbox_teksti(lat, lon, puoli_m=PUOLI_M):
    dla = puoli_m / 110574.0
    dlo = puoli_m / (111320.0 * math.cos(math.radians(lat)))
    return f"{lat - dla:.6f},{lon - dlo:.6f},{lat + dla:.6f},{lon + dlo:.6f},urn:ogc:def:crs:EPSG::4326"


def _geom_tilasto(kohde):
    """Geometrian koko: renkaita, pisteitä, rajauslaatikko (akselijärjestys aineiston oma)."""
    renkaita = pisteita = 0
    a0 = b0 = math.inf
    a1 = b1 = -math.inf
    for el in kohde.iter():
        if _pn(el.tag) == "posList" and el.text:
            v = el.text.split()
            dim = int(el.attrib.get("srsDimension", "2") or 2)
            renkaita += 1
            pisteita += len(v) // dim
            try:
                a = [float(x) for x in v[0::dim]]
                b = [float(x) for x in v[1::dim]]
                a0, a1, b0, b1 = min(a0, min(a)), max(a1, max(a)), min(b0, min(b)), max(b1, max(b))
            except ValueError:
                pass
    return {"renkaita": renkaita, "pisteita": pisteita,
            "laatikko": [round(a0, 5), round(b0, 5), round(a1, 5), round(b1, 5)] if renkaita and math.isfinite(a0) else None}


def _ominaisuudet(kohde, syvyys=4):
    """Kaikki tekstilehdet polkuineen (ei geometriaa), esim. inspireId/Identifier/localId = '…'; xlink:href attribuutit."""
    out = {}

    def kay(el, polku, taso):
        n = _pn(el.tag)
        if n in ("geometry", "referencePoint", "MultiSurface", "Surface", "Polygon", "Point", "posList", "pos"):
            return
        p = f"{polku}/{n}" if polku else n
        for k, v in el.attrib.items():
            if _pn(k) in ("href", "title", "nilReason", "uom"):
                out[f"{p}@{_pn(k)}"] = v[:120]
        lapset = list(el)
        if not lapset and el.text and el.text.strip():
            out[p] = el.text.strip()[:120]
        elif taso < syvyys:
            for c in lapset:
                kay(c, p, taso + 1)

    for c in kohde:
        kay(c, "", 0)
    return out


def jasenna(xml, katkaistu=False):
    """GetFeature-vastaus → {kohteita, kohteet: [{tyyppi, id, ominaisuudet, geometria}], virhe?, alku?}."""
    teksti = xml.decode("utf-8", "replace") if isinstance(xml, bytes) else xml
    if "ExceptionReport" in teksti[:3000] or "ServiceException" in teksti[:3000]:
        return {"kohteita": 0, "kohteet": [], "virhe": re.sub(r"\s+", " ", teksti[:500])}
    if katkaistu:
        tunnukset = [x.strip() for x in re.findall(r"<(?:\w+:)?nationalCadastralReference\b[^>]*>([^<]+)<", teksti)]
        return {"kohteita": None, "kohteet": [], "virhe": f"vastaus yli {MAX_TAVUT // 1048576} Mt, katkaistu",
                "tunnukset_tekstista": sorted(set(tunnukset))[:20], "alku": teksti[:1500]}
    try:
        juuri = ET.fromstring(teksti)
    except ET.ParseError as e:
        return {"kohteita": 0, "kohteet": [], "virhe": f"XML: {e}", "alku": teksti[:1500]}
    kohteet = []
    for jasen in juuri.iter():
        if _pn(jasen.tag) not in ("member", "featureMember"):
            continue
        for k in jasen:
            kohteet.append({"tyyppi": _pn(k.tag), "id": next((v for a, v in k.attrib.items() if _pn(a) == "id"), None),
                            "ominaisuudet": _ominaisuudet(k), "geometria": _geom_tilasto(k)})
    return {"kohteita": len(kohteet), "kohteet": kohteet, "palautettu": juuri.attrib.get("numberReturned"),
            "loytyi": juuri.attrib.get("numberMatched")}


def koepisteet(alueet):
    """[(alue, nimi, lat, lon)]: alueen keskileveydellä 7 pistettä lännestä itään + Kolmoispatti ja luiskat/satamat."""
    out = []
    for a in alueet:
        if not a.get("lohirajat"):
            continue
        r = a["rajat"]
        lat = (a.get("keski") or [(r["lat_min"] + r["lat_max"]) / 2])[0]
        for k in range(7):
            lon = r["lon_min"] + (r["lon_max"] - r["lon_min"]) * (k + 0.5) / 7
            out.append((a["tunnus"], f"poikki {k + 1}/7", round(lat, 5), round(lon, 5)))
        for m in a.get("merkit") or []:
            if m.get("nimi") in ("Kolmoispatti", "Kallan", "Tankar", "Norrskär", "Mikkelinsaaret"):
                out.append((a["tunnus"], m["nimi"], m["lat"], m["lon"]))
        for p in a.get("lahtopisteet") or []:
            out.append((a["tunnus"], "lähtö " + p["nimi"], p["lat"], p["lon"]))
    return out


def aja(perus, alueet, sivun_osoite=None, loki=print, hae=_hae, nyt=None, hae_vanha=None):
    """Koeajo. Kirjoittaa perus/vesialue_koe.json. Palauttaa tiedoston sisällön (tai edellisen, jos alle vuorokausi)."""
    nyt = nyt or datetime.now(timezone.utc)
    polku = os.path.join(perus, TIEDOSTO)
    if sivun_osoite and hae_vanha:
        try:
            vanha = hae_vanha(sivun_osoite + TIEDOSTO)
            if not vanha:
                raise ValueError("ei julkaistua tulosta")
            ika_h = (nyt - datetime.strptime(vanha["luotu"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)).total_seconds() / 3600
            if vanha.get("versio") == VERSIO and ika_h < 24:
                with open(polku, "w", encoding="utf-8") as f:
                    json.dump(vanha, f, ensure_ascii=False, indent=1)
                loki(f"vesialuekoe: tehty {ika_h:.0f} h sitten – ei uudelleen (tulos {TIEDOSTO})")
                return vanha
        except Exception as e:  # noqa: BLE001
            loki(f"vesialuekoe: edellistä ei saatu ({str(e)[:100]})")
    alku = time.monotonic()
    tulos = {"versio": VERSIO, "luotu": nyt.strftime("%Y-%m-%dT%H:%M:%SZ"), "wfs": WFS, "lahde": "Maanmittauslaitos, INSPIRE Cadastral Parcels (CC BY 4.0)",
             "kyvyt": None, "pisteet": [], "virheet": []}
    try:
        d, _, tyyppi = hae(WFS + "?service=WFS&request=GetCapabilities&version=2.0.0", 60)
        k = kyvyt(d)
        tulos["kyvyt"] = k
        tyypit = ", ".join("%s %s" % (t["nimi"], t["crs"][:3]) for t in k["tyypit"])
        loki(f"vesialuekoe: WFS {k['versio']}, tyypit: {tyypit}")
        loki(f"vesialuekoe: muodot {k['muodot']}; suodattimet {k['suodattimet'][:20]}; sivutus {k['sivutus']}")
    except Exception as e:  # noqa: BLE001
        tulos["virheet"].append(f"GetCapabilities: {str(e)[:200]}")
        loki(f"vesialuekoe: VIRHE GetCapabilities {e}")
        k = {"tyypit": [], "versio": "2.0.0"}
    cp = valitse_tyyppi(k["tyypit"]) or "cp:CadastralParcel"
    bpu = valitse_tyyppi(k["tyypit"], "basicpropertyunit")
    loki(f"vesialuekoe: palstatyyppi {cp}, perusyksikkö {bpu}")
    ensimmainen = True
    for tunnus, nimi, lat, lon in koepisteet(alueet):
        if time.monotonic() - alku > KOE_S:
            tulos["virheet"].append(f"aikaraja {KOE_S} s ennen pistettä {tunnus} {nimi}")
            break
        p = {"alue": tunnus, "nimi": nimi, "lat": lat, "lon": lon}
        q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": cp, "count": 10, "bbox": bbox_teksti(lat, lon)}
        try:
            t0 = time.monotonic()
            d, katk, tyyppi = hae(WFS + "?" + urllib.parse.urlencode(q), 90)
            r = jasenna(d, katk)
            p.update({"tavuja": len(d), "s": round(time.monotonic() - t0, 1)}, **r)
            if ensimmainen and (r.get("kohteita") or r.get("virhe")):
                p["vastauksen_alku"] = d[:2500].decode("utf-8", "replace")
                ensimmainen = False
            for kk in r.get("kohteet", []):
                om = kk["ominaisuudet"]
                ktunnus = next((v for a, v in om.items() if "nationalCadastralReference" in a), None)
                nimi2 = next((v for a, v in om.items() if a.endswith("label")), None)
                ala = next((v for a, v in om.items() if "areaValue" in a and "@" not in a), None)
                loki(f"vesialuekoe {tunnus} {nimi} ({lat:.4f} {lon:.4f}): {kk['tyyppi']} tunnus {ktunnus} label {nimi2} "
                     f"ala {ala} · geometria {kk['geometria']['renkaita']} rengasta {kk['geometria']['pisteita']} pistettä · {len(d) // 1024} kt")
            if not r.get("kohteet"):
                loki(f"vesialuekoe {tunnus} {nimi} ({lat:.4f} {lon:.4f}): {r.get('virhe') or 'ei palstaa'}"
                     + (f" · tunnukset tekstistä {r.get('tunnukset_tekstista')}" if r.get("tunnukset_tekstista") else ""))
        except Exception as e:  # noqa: BLE001
            p["virhe"] = str(e)[:200]
            loki(f"vesialuekoe {tunnus} {nimi}: VIRHE {str(e)[:160]}")
        tulos["pisteet"].append(p)
    # Perusyksikkö (BasicPropertyUnit) ensimmäisestä poikkileikkauksen pisteestä: onko lisätietoja (esim. rekisteriyksikön laji)?
    if bpu and tulos["pisteet"] and time.monotonic() - alku < KOE_S:
        p0 = tulos["pisteet"][0]
        q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": bpu, "count": 3, "bbox": bbox_teksti(p0["lat"], p0["lon"])}
        try:
            d, katk, _ = hae(WFS + "?" + urllib.parse.urlencode(q), 90)
            r = jasenna(d, katk)
            tulos["perusyksikko"] = {"piste": [p0["alue"], p0["nimi"]], "tavuja": len(d), **r, "alku": d[:1500].decode("utf-8", "replace")}
            loki(f"vesialuekoe perusyksikkö: {r.get('kohteita')} kohdetta, ominaisuudet "
                 f"{sorted(set(a for kk in r.get('kohteet', []) for a in kk['ominaisuudet']))[:25]}")
        except Exception as e:  # noqa: BLE001
            tulos["virheet"].append(f"perusyksikkö: {str(e)[:200]}")
    # Yhteenveto: tunnusten muodot (osat viivoilla tai 14 merkkiä) poikkileikkauksen järjestyksessä
    yht = {}
    for p in tulos["pisteet"]:
        for kk in p.get("kohteet", []):
            t = next((v for a, v in kk["ominaisuudet"].items() if "nationalCadastralReference" in a), None)
            if t:
                yht.setdefault(p["alue"], []).append(f"{p['nimi']}: {t}")
    tulos["yhteenveto"] = yht
    tulos["kesto_s"] = round(time.monotonic() - alku, 1)
    for a, rivit in yht.items():
        loki(f"vesialuekoe yhteenveto {a}: " + " | ".join(rivit)[:900])
    with open(polku, "w", encoding="utf-8") as f:
        json.dump(tulos, f, ensure_ascii=False, indent=1)
    loki(f"vesialuekoe: valmis {tulos['kesto_s']} s, {len(tulos['pisteet'])} pistettä, kirjoitettu {TIEDOSTO} ({os.path.getsize(polku) // 1024} kt)")
    return tulos


if __name__ == "__main__":   # käsin: python koe_vesialueet.py kansio
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import hae_copernicus
    aja(sys.argv[1] if len(sys.argv) > 1 else ".", hae_copernicus.lue_alueet())
