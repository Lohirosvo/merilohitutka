"""Merilohitutka – hae_vaylat.py (v13: alue parametrina; v61: turvalaitteet ja vesiliikennemerkit)

v61 (Hannu 21.11.2026 "Saako meriviitat kartalle?" → "Kaikki ja 5 km ok"): samasta rajapinnasta myös turvalaitteet
(tasot turvalaitteet*, ei laajat_tiedot eikä viat) ja vesiliikennemerkit (vesiliikennemerk*) pisteinä avaimeen "merkit".
Kentät [L, rajapinnan OGC-sivu 21.11.2026]: turvalaitenumero, nimifi, turvalaitetyyppifi (Viitta, Kummeli, Linjamerkki …),
alityyppi (KELLUVA/KIINTEÄ), valaistu (K/E), navigointilajikoodi, symboli, sijaintifi. Vesiliikennemerkkien kenttiä ei
tunneta: tekstiksi otetaan tyyppi-, laji-, rajoitus- ja nimikentät, ja ensimmäisen kohteen kentät tulostuvat lokiin.

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
# v11-lokista: väylätiedoissa kentät "mitoitussyvays" ja "haraussyvyys" (ei "kulkusyvyys").
SYVYYS_KENTAT = ["mitoitussyvays", "kulkusyvyys", "kulkusyvyys1", "syvyys"]
HARAUS_KENTAT = ["haraussyvyys"]
LAHDE = "Väylävirasto, vesiväyläaineisto (navigointilinjat, väyläalueet)"
HUOM = "Aineisto ei sovellu navigointikäyttöön."
UUSINTA_VRK = 30
VERSIO = 4   # v61: merkit mukaan -> vanha haetaan uudelleen (v12: kaikki väylätasot, mitoitus- ja haraussyvyys)
MERKKI_AVAIMET = ["turvalaitteet", "turvalaite"]
MERKKI_POIS = ["laaja", "vika", "viat"]
VLM_AVAIMET = ["vesiliikennemerk"]
VLM_KENTAT = ["vlmlaji", "merkkilaji", "merkkilajifi", "laji", "lajifi", "tyyppi", "tyyppifi", "merkkityyppi", "merkkityyppifi",
              "vesiliikennemerkkityyppi", "rajoitus", "rajoitusarvo", "arvo", "nopeus", "lisakilpi", "lisakilpifi", "nimifi", "nimi"]


def _valitse(nimet, avaimet):
    """Kaikki tasot, joiden nimi alkaa avaimella (v11: navigointilinjat_uusi = Väylävirasto,
    navigointilinjat_muut_vaylanpitajat = esim. kaupungit). Vesiväylätasot ensin."""
    out = []
    for n in nimet:
        pieni = n.lower().split(":")[-1]
        if any(pieni == a or pieni.startswith(a) for a in avaimet):
            out.append(n)
    return sorted(out, key=lambda n: (not n.lower().startswith("vesivayla"), n))


def _koodaa_kaikki(kohteet, jarjestys, origo):
    """-> [{"s": mitoitussyväys, "h": haraussyvyys, "k": koodattu viiva}]"""
    out = []
    for syv, osat, ominaisuudet in kohteet:
        haraus = W.syvyysarvo(ominaisuudet, HARAUS_KENTAT) if any(k.lower() in HARAUS_KENTAT for k in ominaisuudet) else None
        for o in osat:
            if len(o) < 2:
                continue
            k = W.koodaa(W.yksinkertaista(W.muunna(o, jarjestys), 4.0), origo)
            if len(k) >= 4:
                out.append({"s": syv, "h": haraus, "k": k})
    return out


def _kentta(om, *nimet):
    m = {str(k).lower(): v for k, v in om.items()}
    for n in nimet:
        v = m.get(n)
        if v not in (None, "") and not isinstance(v, (dict, list)):
            return v
    return None


def _luku(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _merkki(om, lat, lon, vlm):
    """Yksi turvalaite tai vesiliikennemerkki tiiviiksi: p = [lat, lon], k = tl/vlm, muut tekstiä tai lukuja."""
    p = [round(lat, 5), round(lon, 5)]
    if vlm:
        osat, nahty = [], set()
        m = {str(k).lower(): v for k, v in om.items()}
        for n in VLM_KENTAT:
            v = m.get(n)
            if v not in (None, "") and not isinstance(v, (dict, list)) and str(v) not in nahty:
                nahty.add(str(v)); osat.append(str(v)[:40])
        return {"p": p, "k": "vlm", "t": " · ".join(osat)[:120] or "vesiliikennemerkki",
                "u": _kentta(om, "vlmnumero", "merkkinumero", "numero", "turvalaitenumero")}
    x = _kentta(om, "sijaintifi", "sijaintis")
    return {"p": p, "k": "tl", "u": _luku(_kentta(om, "turvalaitenumero", "tlnumero")), "n": _kentta(om, "nimifi", "nimis"),
            "t": _kentta(om, "turvalaitetyyppifi"), "a": _kentta(om, "alityyppi", "subtype"),
            "l": _luku(_kentta(om, "navigointilajikoodi", "navl_tyyp")), "s": _kentta(om, "symboli"),
            "v": _kentta(om, "valaistu"), "x": str(x)[:90] if x else None}


def hae_merkit(osoite, versio, nimet, muodot, loki=print, alue=None):
    """-> (merkit, tasot, virhe). Kaksoiskappaleet (sama turvalaitenumero) pois."""
    tl = [n for n in _valitse(nimet, MERKKI_AVAIMET) if not any(x in n.lower() for x in MERKKI_POIS)]
    vlm = _valitse(nimet, VLM_AVAIMET)
    loki(f"  merkit: turvalaitetasot {', '.join(tl) or '-'}; vesiliikennemerkit {', '.join(vlm) or '-'}")
    out, nahty, virheet = [], set(), []
    for tasot, on_vlm in ((tl, False), (vlm, True)):
        for taso in tasot:
            try:
                kohteet = W.hae_kohteet(osoite, versio, taso, muodot, loki, None, alue)
            except Exception as e:  # noqa: BLE001
                virheet.append(f"{taso}: {e}"[:200]); continue
            if not kohteet:
                loki(f"  {taso}: ei kohteita alueella"); continue
            loki(f"  {taso}: {len(kohteet)} kohdetta; esimerkki: {json.dumps(kohteet[0][2], ensure_ascii=False)[:500]}")
            ekat = next((o[0] for k in kohteet for o in k[1] if o), None)
            if not ekat:
                continue
            jarj = W.tulkitse_jarjestys(*ekat)
            for _, osat, om in kohteet:
                if not osat or not osat[0]:
                    continue
                lat, lon = W.muunna([osat[0][0]], jarj)[0]
                m = _merkki(om, lat, lon, on_vlm)
                avain = (m["k"], m.get("u")) if m.get("u") is not None else (m["k"], tuple(m["p"]), m.get("t"))
                if avain in nahty:
                    continue
                nahty.add(avain); out.append(m)
    return out, tl + vlm, (" | ".join(virheet) or None) if not out else None


def hae_vaylavirastolta(loki=print, alue=None):
    virheet = []
    for osoite in WFS:
        try:
            xml_teksti, _ = W._hae(osoite, {"service": "WFS", "request": "GetCapabilities"}, 60)
            versio, nimet, muodot = W.tasot_kyvyista(xml_teksti)
        except Exception as e:  # noqa: BLE001
            virheet.append(f"{osoite}: GetCapabilities {e}")
            loki(f"väylät: {osoite} GetCapabilities epäonnistui: {e}")
            continue
        linjat, alueet = _valitse(nimet, LINJA_AVAIMET), _valitse(nimet, ALUE_AVAIMET)
        loki(f"väylät: {osoite} WFS {versio}, {len(nimet)} tasoa; navigointilinjat: {', '.join(linjat)}; "
             f"väyläalueet: {', '.join(alueet)}")
        if not linjat and not alueet:
            virheet.append(f"{osoite}: ei väylätasoja")
            continue
        origo = W.origo_alueelle(alue)
        tulos = {"muoto": 1, "versio": VERSIO, "luotu": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "lahde": LAHDE,
                 "huom": HUOM, "lisenssi": "CC BY 4.0", "origo": list(origo), "kerroin": W.KERROIN, "alue": alue or W.ALUE,
                 "syvyydet": "s = mitoitussyväys, h = haraussyvyys (Väyläviraston kentät mitoitussyvays, haraussyvyys)",
                 "linjat": [], "alueet": [], "merkit": []}
        for tasot, avain in ((linjat, "linjat"), (alueet, "alueet")):
            for taso in tasot:
                kohteet = W.hae_kohteet(osoite, versio, taso, muodot, loki, SYVYYS_KENTAT, alue)
                if not kohteet:
                    loki(f"  {taso}: ei kohteita alueella")
                    continue
                loki(f"  {taso}: {len(kohteet)} kohdetta; esimerkki: {json.dumps(kohteet[0][2], ensure_ascii=False)[:300]}")
                a, b = next(p for k in kohteet for o in k[1] for p in o[:1])
                tulos[avain] += _koodaa_kaikki(kohteet, W.tulkitse_jarjestys(a, b), origo)
        try:   # v61: merkit; virhe ei estä väyliä
            merkit, mtasot, mvirhe = hae_merkit(osoite, versio, nimet, muodot, loki, alue)
        except Exception as e:  # noqa: BLE001
            merkit, mtasot, mvirhe = [], [], f"odottamaton virhe: {e}"[:300]
        tulos["merkit"] = merkit
        tulos["merkitLahde"] = "Väylävirasto, vesiväyläaineisto (" + (", ".join(mtasot) or "ei tasoja") + ")"
        if mvirhe or not merkit:
            tulos["merkitVirhe"] = mvirhe or "ei merkkejä"
        if tulos["linjat"] or tulos["alueet"]:
            loki(f"  väyliä: {len(tulos['linjat'])} linjaa, {len(tulos['alueet'])} aluereunaa, merkkejä {len(merkit)}")
            return tulos, None
    return None, " | ".join(virheet)[:500]


def paivita(kansio, sivun_osoite, loki=print, alue=None):
    """Kirjoittaa kansio/vaylat.json. Palauttaa tilan meri.json:iin."""
    polku = os.path.join(kansio, "vaylat.json")
    vanha = None
    try:
        with urllib.request.urlopen(urllib.request.Request(sivun_osoite + "vaylat.json", headers=W.OTSAKE), timeout=30) as r:
            vanha = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        loki(f"väylät: edellistä vaylat.json:ia ei saatu ({e})")
    varalla = vanha
    if vanha and alue and vanha.get("alue") not in (None, alue):
        loki("väylät: edellinen tiedosto on eri alueelta – haetaan uudelleen")
        vanha = varalla = None
    if vanha and vanha.get("versio", 1) < VERSIO:
        loki("väylät: edellinen tiedosto on vanhaa versiota – haetaan uudelleen")
        vanha = None
    if vanha and "linjat" in vanha:
        try:
            ika = (datetime.now(timezone.utc) - datetime.strptime(vanha["luotu"], "%Y-%m-%dT%H:%M:%SZ")
                   .replace(tzinfo=timezone.utc)).days
        except Exception:  # noqa: BLE001
            ika = 999
        if ika < UUSINTA_VRK and not (vanha.get("merkitVirhe") and ika >= 1):   # v61: merkit uudelleen seuraavana päivänä
            with open(polku, "w", encoding="utf-8") as f:
                json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
            loki(f"väylät: käytetään edellistä ({ika} vrk vanha)")
            return {"tila": "ok", "luotu": vanha["luotu"]}
    try:
        uusi, virhe = hae_vaylavirastolta(loki, alue)
    except Exception as e:  # noqa: BLE001
        uusi, virhe = None, f"odottamaton virhe: {e}"
    if uusi:
        with open(polku, "w", encoding="utf-8") as f:
            json.dump(uusi, f, ensure_ascii=False, separators=(",", ":"))
        loki(f"väylät: kirjoitettu {polku}, {os.path.getsize(polku) // 1024} kt")
        return {"tila": "ok", "luotu": uusi["luotu"]}
    loki(f"väylät: VIRHE {virhe}")
    vanha = varalla
    if vanha and "linjat" in vanha:
        with open(polku, "w", encoding="utf-8") as f:
            json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
        return {"tila": "vanha", "luotu": vanha["luotu"], "viesti": virhe}
    return {"tila": "virhe", "viesti": virhe}
