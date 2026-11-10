"""Merilohitutka – hae_vaylat.py (v9)

Hakee Väyläviraston vesiväyläaineistosta (avoin WFS, CC BY 4.0) alueen navigointilinjat ja
väyläalueet (reunat + kulkusyvyys) ja kirjoittaa ne tiedostoon data/vaylat.json.

Lähde: Väylävirasto, vesiväyläaineisto. Aineisto ei sovellu navigointikäyttöön.

Väylät muuttuvat harvoin: julkaistulla sivulla oleva alle 30 vrk vanha vaylat.json käytetään sellaisenaan.
Rajapintaa ei voitu testata ennen ensimmäistä ajoa: tasojen nimet ja esimerkkiominaisuudet tulostuvat lokiin.
"""
import json
import os
import urllib.request
from datetime import datetime, timezone

import hae_syvyys as W   # WFS-apufunktiot (GetCapabilities, GeoJSON/GML, bbox, sivutus, koordinaatit)

WFS = ["https://avoinapi.vaylapilvi.fi/vaylatiedot/ows", "https://avoinapi.vaylapilvi.fi/vaylatiedot/wfs"]
LINJA_AVAIMET = ["navigointilinja", "navigointilinjat"]
ALUE_AVAIMET = ["vaylaalue", "vaylaalueet", "väyläalue"]
SYVYYS_KENTAT = ["kulkusyvyys", "kulkusyvyys1", "kulkusyv", "syvyys", "vaylan_syvyys"]
LAHDE = "Väylävirasto, vesiväyläaineisto (navigointilinjat, väyläalueet)"
HUOM = "Aineisto ei sovellu navigointikäyttöön."
UUSINTA_VRK = 30


def _valitse(nimet, avaimet):
    for n in nimet:
        pieni = n.lower().split(":")[-1]
        if any(pieni == a or pieni.startswith(a) for a in avaimet):
            return n
    for n in nimet:
        if any(a in n.lower() for a in avaimet):
            return n
    return None


def _koodaa_kaikki(kohteet, jarjestys, origo, kentat_mukaan):
    out = []
    for syv, osat, _ in kohteet:
        for o in osat:
            if len(o) < 2:
                continue
            k = W.koodaa(W.yksinkertaista(W.muunna(o, jarjestys), 4.0), origo)
            if len(k) >= 4:
                out.append({"s": syv, "k": k} if kentat_mukaan else k)
    return out


def hae_vaylavirastolta(loki=print):
    virheet = []
    for osoite in WFS:
        try:
            xml_teksti, _ = W._hae(osoite, {"service": "WFS", "request": "GetCapabilities"}, 60)
            versio, nimet, muodot = W.tasot_kyvyista(xml_teksti)
        except Exception as e:  # noqa: BLE001
            virheet.append(f"{osoite}: GetCapabilities {e}")
            loki(f"väylät: {osoite} GetCapabilities epäonnistui: {e}")
            continue
        vesi = [n for n in nimet if "vesi" in n.lower() or "vayl" in n.lower() or "navig" in n.lower()]
        loki(f"väylät: {osoite} WFS {versio}, {len(nimet)} tasoa; vesiväylätasot: {', '.join(vesi)[:900]}")
        linja, alue = _valitse(nimet, LINJA_AVAIMET), _valitse(nimet, ALUE_AVAIMET)
        loki(f"  navigointilinjat: {linja}; väyläalueet: {alue}")
        if not linja and not alue:
            virheet.append(f"{osoite}: ei väylätasoja")
            continue
        origo = (int(W.ALUE["lat_min"] * 10) / 10, int(W.ALUE["lon_min"] * 10) / 10)
        tulos = {"muoto": 1, "luotu": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "lahde": LAHDE,
                 "huom": HUOM, "lisenssi": "CC BY 4.0", "origo": list(origo), "kerroin": W.KERROIN,
                 "linjat": [], "alueet": []}
        for taso, avain in ((linja, "linjat"), (alue, "alueet")):
            if not taso:
                continue
            kohteet = W.hae_kohteet(osoite, versio, taso, muodot, loki, SYVYYS_KENTAT)
            if not kohteet:
                virheet.append(f"{taso}: ei kohteita")
                continue
            loki(f"  {avain}: {len(kohteet)} kohdetta; esimerkki: {json.dumps(kohteet[0][2], ensure_ascii=False)[:400]}")
            a, b = next(p for k in kohteet for o in k[1] for p in o[:1])
            tulos[avain] = _koodaa_kaikki(kohteet, W.tulkitse_jarjestys(a, b), origo, avain == "alueet")
        if tulos["linjat"] or tulos["alueet"]:
            loki(f"  väyliä: {len(tulos['linjat'])} linjaa, {len(tulos['alueet'])} aluereunaa")
            return tulos, None
    return None, " | ".join(virheet)[:500]


def paivita(kansio, sivun_osoite, loki=print):
    """Kirjoittaa kansio/vaylat.json. Palauttaa tilan meri.json:iin."""
    polku = os.path.join(kansio, "vaylat.json")
    vanha = None
    try:
        with urllib.request.urlopen(urllib.request.Request(sivun_osoite + "vaylat.json", headers=W.OTSAKE), timeout=30) as r:
            vanha = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        loki(f"väylät: edellistä vaylat.json:ia ei saatu ({e})")
    if vanha and "linjat" in vanha:
        try:
            ika = (datetime.now(timezone.utc) - datetime.strptime(vanha["luotu"], "%Y-%m-%dT%H:%M:%SZ")
                   .replace(tzinfo=timezone.utc)).days
        except Exception:  # noqa: BLE001
            ika = 999
        if ika < UUSINTA_VRK:
            with open(polku, "w", encoding="utf-8") as f:
                json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
            loki(f"väylät: käytetään edellistä ({ika} vrk vanha)")
            return {"tila": "ok", "luotu": vanha["luotu"]}
    try:
        uusi, virhe = hae_vaylavirastolta(loki)
    except Exception as e:  # noqa: BLE001
        uusi, virhe = None, f"odottamaton virhe: {e}"
    if uusi:
        with open(polku, "w", encoding="utf-8") as f:
            json.dump(uusi, f, ensure_ascii=False, separators=(",", ":"))
        loki(f"väylät: kirjoitettu {polku}, {os.path.getsize(polku) // 1024} kt")
        return {"tila": "ok", "luotu": uusi["luotu"]}
    loki(f"väylät: VIRHE {virhe}")
    if vanha and "linjat" in vanha:
        with open(polku, "w", encoding="utf-8") as f:
            json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
        return {"tila": "vanha", "luotu": vanha["luotu"], "viesti": virhe}
    return {"tila": "virhe", "viesti": virhe}
