"""Merilohitutka – hae_copernicus.py (v13: useita alueita)

Hakee Copernicus Marinesta Uusikaarlepyy–Tankar-alueen meridatan koko ennustejaksolle (9 vrk,
3 h välein) ja kirjoittaa sen sovellusta varten:
  data/meri.json          hakemisto: ruudukot, syvyystasot, satelliittilämpö, päivälista
  data/p_VVVVKKPP.json    yksi tiedosto Suomen ajan vuorokautta kohden: lämpöprofiili 0–12 m,
                          pintavirta ja aallot. Sovellus lataa vain valitun päivän.

Luvut tallennetaan kokonaislukuina (×100): lämpö 0,01 °C, virta cm/s, aalto cm. Tiedosto pysyy pienenä.

Ajetaan GitHub Actionsissa (julkaise.yml). Tunnus luetaan ympäristömuuttujista
COPERNICUSMARINE_SERVICE_USERNAME ja COPERNICUSMARINE_SERVICE_PASSWORD (GitHubin salaisuudet).

Jos fysiikkamallin haku epäonnistuu, edellisen ajon päivätiedostot ladataan julkaistulta sivulta,
jotta vanha data säilyy.

v8: ajaa ensin myös Traficomin syvyyskäyrien päivityksen (hae_syvyys.py, data/syvyys.json).
v9: lisäksi Väyläviraston väylät (hae_vaylat.py, data/vaylat.json) ja IL:n tuuliennuste kartan
pisteisiin (hae_tuuli.py, päivätiedostoihin). Näiden epäonnistuminen ei vaikuta Copernicus-hakuun.

v54 (17.11.2026): alueille, joilla "silakka": {"happi": true} (Eckerö), BGC-hakuun myös pohjan happi o2b (mmol/m3,
päivätiedoston bgc.o2b); jos se ei onnistu, haetaan kd/zsd kuten ennen.

v48 (16.11.2026): silakka-alueille myös pohjan lämpö (bottomT) ja sekoittumiskerroksen paksuus (mlotst) PHY-mallista
(tuntiaineisto 3 h välein, varalla päiväaineisto) päivätiedostoihin (kerros.pt °C × 100, kerros.mld m × 10). Oma haku.

v44 (16.11.2026): silakka-alueille myös IL:n kokonaispilvisyys tuulipisteisiin (hae_tuuli.hae_pilvi, päivätiedoston
tuuli.pc, %). Virhe ei vaikuta tuuleen.

v43 (Hannu 16.11.2026, silakkatietopohja v006 kohta 1.1): alueille, joilla alueet.js:ssä on "silakka"-kohta (nyt vain Luoto),
lisäksi valon vaimennus BGC-mallista (kd ja Secchi zsd, hetkiarvo klo 12 UTC päiväaineistossa) päivätiedostoihin ja
mallin pohjan syvyys (deptho, staattinen) hakemistoon. Virhe ei vaikuta muihin hakuihin.

v13: alueet luetaan tiedostosta alueet.js (sama tiedosto kuin sovelluksessa). Jokainen alue haetaan erikseen
omaan kansioonsa: Luoto data/ (kuten ennen), muut data/<tunnus>/. Yhden alueen virhe ei estä muita.

Käyttö:  python hae_copernicus.py polku/data/meri.json
"""
import json
import os
import sys
import time
import traceback
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

# Alue: Uusikaarlepyy (63,5) – Tankar (63,95), länteen avomerelle
ALUE = dict(lat_min=63.45, lat_max=64.05, lon_min=22.05, lon_max=23.10)
TUNNIT_TAAKSE = 3
TUNNIT_ETEEN = 9 * 24 + 3     # koko ennuste (tuote: 9 vrk); yli menevä osa jää pois itsestään
ASKEL_H = 3                    # vain UTC-tunnit 0, 3, 6, … (tasainen aikasarja)
SYVYYS_MAX = 12.5              # lämpöprofiili 0–12 m (Hannu: nousulohi max 12 m)
VYOHYKE = ZoneInfo("Europe/Helsinki")
KERROIN = 100                  # tallennus kokonaislukuina: arvo × 100
VIRTA_SYV = 3.0                # m, toinen virtataso: nopeus veden suhteen 3 m:ssä (Hannu 13.11.2026)

# Tuote-ID:t ja muuttujat. Jos tunnus on väärä, skripti tulostaa lokiin Itämeren datasetit.
LAHTEET = {
    "phy": dict(tuote="BALTICSEA_ANALYSISFORECAST_PHY_003_006",
                ehdokkaat=["cmems_mod_bal_phy_anfc_PT1H-i"],
                muuttujat=["thetao", "uo", "vo"]),
    "wav": dict(tuote="BALTICSEA_ANALYSISFORECAST_WAV_003_010",
                ehdokkaat=["cmems_mod_bal_wav_anfc_PT1H-i"],
                muuttujat=["VHM0", "VMDR"],
                lisa=["VTM10", "VTPK"]),   # v29: Tm-1,0, v30: huippujakso Tp (valinnaisia: ilman niitä haku toimii kuten ennen)
    "sst": dict(tuote="SST_BAL_SST_L4_NRT_OBSERVATIONS_010_007_b",
                ehdokkaat=["DMI-BALTIC-SST-L4-NRT-OBS_FULL_TIME_SERIE"],
                muuttujat=["analysed_sst"]),
    # v43: PUM CMEMS-BAL-PUM-003-006-007: kd [m-1] "Light Attenuation" ja zsd [m] Secchi, hetkiarvot klo 12 UTC
    # päiväaineistossa (ei tuntiaineistoa). deptho staattisessa mask_bathy-tiedostossa.
    "bgc": dict(tuote="BALTICSEA_ANALYSISFORECAST_BGC_003_007",
                ehdokkaat=["cmems_mod_bal_bgc_anfc_P1D-m"],
                muuttujat=["kd", "zsd"]),
    # v48: pohjan lämpö ja sekoittumiskerros (2D). Tuotesivun mukaan tunti-, päivä- ja kuukausiaineistoissa; tuntiaineisto
    # ensin (3 h välein kuten lämpö), varalla päiväaineisto. mlotst = "Ocean mixed layer thickness defined by density".
    "kerros": dict(tuote="BALTICSEA_ANALYSISFORECAST_PHY_003_006",
                   ehdokkaat=["cmems_mod_bal_phy_anfc_PT1H-i", "cmems_mod_bal_phy_anfc_P1D-m"],
                   muuttujat=["bottomT", "mlotst"]),
    "pohja": dict(tuote="BALTICSEA_ANALYSISFORECAST_PHY_003_006",
                  ehdokkaat=["cmems_mod_bal_phy_anfc_static", "cmems_mod_bal_bgc_anfc_static"],
                  muuttujat=["deptho"]),
}
KD_KERROIN, ZSD_KERROIN, POHJA_KERROIN = 1000, 100, 10   # v43: kd 0,001 m-1, zsd cm, pohja dm
PT_KERROIN, MLD_KERROIN = 100, 10                         # v48: pohjan lämpö 0,01 °C, sekoittumiskerros dm
O2_KERROIN = 1                                            # v54: pohjan happi mmol/m3 (1 ml/l = 44,66 mmol/m3)


# ---------------------------------------------------------------- muunnos (testattava ilman verkkoa)

def pyorista(taulukko, desimaalit):
    """numpy-taulukko -> sisäkkäinen lista liukulukuja; NaN -> None."""
    a = np.round(np.asarray(taulukko, dtype=float), desimaalit)
    o = a.astype(object)
    o[~np.isfinite(a)] = None
    return o.tolist()


def taso_syvyydella(a, syvyydet, z):
    """a[aika, syvyys, lat, lon] -> a[aika, lat, lon] syvyydellä z, lineaarisesti kahden mallitason välistä.
    Jos alempi taso puuttuu (pohja z:n ja alemman tason välissä) tai z on tasojen ulkopuolella, tulos on NaN
    (paitsi kun z osuu tasolle). Palauttaa (taulukko, kuvaus) tai (None, syy)."""
    syv = np.atleast_1d(np.asarray(syvyydet, dtype=float))
    a = np.asarray(a, dtype=float)
    if a.ndim != 4 or a.shape[1] != len(syv) or not len(syv):
        return None, "ei syvyystasoja"
    k = int(np.argmin(np.abs(syv - z)))
    if abs(syv[k] - z) < 0.01:
        return a[:, k], f"taso {syv[k]:.2f} m"
    if z < syv[0] or z > syv[-1]:
        return None, f"{z} m tasojen {syv[0]:.2f}–{syv[-1]:.2f} m ulkopuolella"
    i = min(int(np.searchsorted(syv, z, side="right")) - 1, len(syv) - 2)
    w = (z - syv[i]) / (syv[i + 1] - syv[i])
    return a[:, i] * (1 - w) + a[:, i + 1] * w, f"tasojen {syv[i]:.2f} ja {syv[i + 1]:.2f} m välistä"


def kokonaisluvut(taulukko, kerroin=KERROIN):
    """numpy-taulukko -> sisäkkäinen lista kokonaislukuja (arvo × kerroin); NaN -> None."""
    a = np.asarray(taulukko, dtype=float) * kerroin
    ok = np.isfinite(a)
    i = np.where(ok, np.round(a), 0).astype(np.int64).astype(object)
    i[~ok] = None
    return i.tolist()


def pintalampo(phy):
    """v27 (Hannu 14.11.2026): alueen pintaveden lämpö ajan funktiona nousun lämpörajaa varten.
    Ylimmän tason (thetao[aika, 0]) meriruudut; 10., 50. ja 90. prosenttipiste joka ajalle (°C, 2 desim.).
    Pieni (n. 80 aikaa) ja kulkee hakemistossa, joten puhelimen ei tarvitse ladata kaikkia päivätiedostoja.
    Palauttaa dict(ajat, p10, p50, p90, n) tai None."""
    t = np.ma.filled(np.ma.asarray(phy["thetao"], dtype=float), np.nan)
    if t.ndim != 4 or not t.shape[0]:
        return None
    ajat, p10, p50, p90 = [], [], [], []
    for i in range(t.shape[0]):
        v = t[i, 0]
        v = v[np.isfinite(v)]
        if not v.size:
            continue
        q = np.percentile(v, [10, 50, 90])
        ajat.append(iso(np.datetime64(phy["ajat"][i])))
        p10.append(round(float(q[0]), 2)); p50.append(round(float(q[1]), 2)); p90.append(round(float(q[2]), 2))
    if not ajat:
        return None
    n = int(np.isfinite(t[0, 0]).sum())
    return {"ajat": ajat, "p10": p10, "p50": p50, "p90": p90, "n": n}


def iso(t):
    """numpy datetime64 / datetime -> 'YYYY-MM-DDTHH:MM:SSZ'."""
    if isinstance(t, np.datetime64):
        t = t.astype("datetime64[s]").astype(datetime).replace(tzinfo=timezone.utc)
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def paikallinen_pvm(t):
    """numpy datetime64 (UTC) -> Suomen ajan päivämäärä 'VVVV-KK-PP'."""
    d = t.astype("datetime64[s]").astype(datetime).replace(tzinfo=timezone.utc)
    return d.astimezone(VYOHYKE).strftime("%Y-%m-%d")


def tasatunnit(ajat, askel=ASKEL_H):
    """Indeksit, joiden UTC-tunti on jaollinen askeleella (0, 3, 6, …)."""
    h = np.asarray(ajat).astype("datetime64[h]").astype(np.int64) % 24
    return np.where(h % askel == 0)[0]


def paivittain(ajat):
    """{pvm: [indeksit]} Suomen ajan vuorokausittain, järjestyksessä."""
    out = {}
    for i, t in enumerate(ajat):
        out.setdefault(paikallinen_pvm(np.datetime64(t)), []).append(i)
    return out


def tiedostonimi(pvm):
    return "p_" + pvm.replace("-", "") + ".json"


def rakenna(phy, wav, sst, luotu, virheet, syvyys=None, tuuli=None, vaylat=None, alue=None, bgc=None, pohja=None, kerros=None):
    """Kokoaa hakemiston ja päivätiedostot.
    phy = dict(ajat, lat, lon, syvyydet, thetao[aika, syvyys, lat, lon], u[aika, lat, lon], v, dataset,
               u3/v3[aika, lat, lon] = virta VIRTA_SYV m:ssä tai None)
    wav = dict(ajat, lat, lon, hs[aika, lat, lon], suunta, dataset) tai None
    sst = valmis JSON-osa tai None
    Palauttaa (hakemisto, {tiedostonimi: sisältö})."""
    hakemisto = {"muoto": 2, "luotu": luotu, "alue": alue or ALUE, "virheet": list(virheet),
                 "lisenssi": "E.U. Copernicus Marine Service Information",
                 "kerroin": KERROIN, "paivat": []}
    if syvyys:
        hakemisto["syvyys"] = syvyys
    if vaylat:
        hakemisto["vaylat"] = vaylat
    t_paivat = {}
    if tuuli and tuuli.get("ajat"):
        hakemisto["tuuli"] = {"pisteet": tuuli["pisteet"], "lahde": tuuli.get("lahde"),
                              "alku": tuuli["ajat"][0], "loppu": tuuli["ajat"][-1]}
        t_paivat = paivittain([np.datetime64(a.replace("Z", "")) for a in tuuli["ajat"]])
    hakemisto["phy"] = {"dataset": phy["dataset"], "lat": pyorista(phy["lat"], 4), "lon": pyorista(phy["lon"], 4),
                        "syvyydet": pyorista(phy["syvyydet"], 2)}
    pinta = pintalampo(phy)   # v27: nousun lämpöraja (alueen pintavesi koko ennustejaksolta)
    if pinta:
        hakemisto["phy"]["pinta"] = pinta
    syva = phy.get("u3") is not None and phy.get("v3") is not None
    if syva:
        hakemisto["phy"]["virtaSyv"] = VIRTA_SYV   # päivätiedostoissa u3/v3 = virta tällä syvyydellä
    if wav:
        hakemisto["wav"] = {"dataset": wav["dataset"], "lat": pyorista(wav["lat"], 4), "lon": pyorista(wav["lon"], 4)}
        if wav.get("jakso") is not None:
            hakemisto["wav"]["jakso"] = "Tm-1,0 (VTM10)"   # v29: päivätiedostoissa wav.jakso (s)
        if wav.get("huippu") is not None:
            hakemisto["wav"]["huippu"] = "Tp (VTPK)"       # v30: päivätiedostoissa wav.huippu (s)
    if sst:
        hakemisto["sst"] = sst
    b_paivat = {}
    if bgc:   # v43: valon vaimennus päivittäin (12 UTC); ruudukko hakemistoon, arvot päivätiedostoihin
        hakemisto["bgc"] = {"dataset": bgc["dataset"], "lat": pyorista(bgc["lat"], 4), "lon": pyorista(bgc["lon"], 4),
                            "kerroin": dict({"kd": KD_KERROIN, "zsd": ZSD_KERROIN}, **({"o2b": O2_KERROIN} if bgc.get("o2b") is not None else {})),
                            "aika": "hetkiarvo klo 12 UTC",
                            "muuttujat": [k for k in ("kd", "zsd", "o2b") if bgc.get(k) is not None]}
        b_paivat = paivittain(bgc["ajat"])
    k_paivat = {}
    if kerros:   # v48: pohjan lämpö ja sekoittumiskerros; ruudukko hakemistoon, arvot päivätiedostoihin
        hakemisto["kerros"] = {"dataset": kerros["dataset"], "lat": pyorista(kerros["lat"], 4), "lon": pyorista(kerros["lon"], 4),
                               "kerroin": {"pt": PT_KERROIN, "mld": MLD_KERROIN},
                               "muuttujat": [k for k in ("pt", "mld") if kerros.get(k) is not None]}
        k_paivat = paivittain(kerros["ajat"])
    if pohja:   # v43: mallin pohjan syvyys (m × 10)
        hakemisto["pohja"] = {"dataset": pohja["dataset"], "lat": pyorista(pohja["lat"], 4), "lon": pyorista(pohja["lon"], 4),
                              "kerroin": POHJA_KERROIN, "syv": kokonaisluvut(pohja["deptho"], POHJA_KERROIN)}

    p_paivat = paivittain(phy["ajat"])
    w_paivat = paivittain(wav["ajat"]) if wav else {}
    tiedostot = {}
    for pvm in sorted(set(p_paivat) | set(w_paivat)):
        sis = {"pvm": pvm, "luotu": luotu}
        ip = p_paivat.get(pvm, [])
        if ip:
            sis["ajat"] = [iso(np.datetime64(phy["ajat"][i])) for i in ip]
            sis["phy"] = {"t": kokonaisluvut(np.asarray(phy["thetao"])[ip]),
                          "u": kokonaisluvut(np.asarray(phy["u"])[ip]),
                          "v": kokonaisluvut(np.asarray(phy["v"])[ip])}
            if syva:
                sis["phy"]["u3"] = kokonaisluvut(np.asarray(phy["u3"])[ip])
                sis["phy"]["v3"] = kokonaisluvut(np.asarray(phy["v3"])[ip])
        iw = w_paivat.get(pvm, [])
        if iw:
            w = {"ajat": [iso(np.datetime64(wav["ajat"][i])) for i in iw],
                 "hs": kokonaisluvut(np.asarray(wav["hs"])[iw])}
            if wav.get("suunta") is not None:
                w["suunta"] = kokonaisluvut(np.asarray(wav["suunta"])[iw], 1)
            if wav.get("jakso") is not None:
                w["jakso"] = kokonaisluvut(np.asarray(wav["jakso"])[iw])   # v29: s × 100
            if wav.get("huippu") is not None:
                w["huippu"] = kokonaisluvut(np.asarray(wav["huippu"])[iw])   # v30: s × 100
            sis["wav"] = w
        if "ajat" not in sis:
            sis["ajat"] = w["ajat"] if iw else []
        ib = b_paivat.get(pvm, [])
        if ib:
            b = {"aika": iso(np.datetime64(bgc["ajat"][ib[0]]))}
            for k, kerroin in (("kd", KD_KERROIN), ("zsd", ZSD_KERROIN), ("o2b", O2_KERROIN)):
                if bgc.get(k) is not None:
                    b[k] = kokonaisluvut(np.asarray(bgc[k])[ib[0]], kerroin)
            sis["bgc"] = b
        ik = k_paivat.get(pvm, [])
        if ik:
            k = {"ajat": [iso(np.datetime64(kerros["ajat"][i])) for i in ik]}
            for nimi, kerroin in (("pt", PT_KERROIN), ("mld", MLD_KERROIN)):
                if kerros.get(nimi) is not None:
                    k[nimi] = kokonaisluvut(np.asarray(kerros[nimi])[ik], kerroin)
            sis["kerros"] = k
        it = t_paivat.get(pvm, [])
        if it:
            sis["tuuli"] = {"ajat": [tuuli["ajat"][i] for i in it],
                            **{k: [tuuli[k][i] for i in it] for k in ("ws", "wd", "wg", "pc") if k in tuuli}}
        nimi = tiedostonimi(pvm)
        tiedostot[nimi] = sis
        hakemisto["paivat"].append({"pvm": pvm, "tiedosto": nimi, "ajat": sis["ajat"]})
    return hakemisto, tiedostot


def kirjoita(kansio, hakemisto, tiedostot):
    yht = 0
    for nimi, sis in tiedostot.items():
        p = os.path.join(kansio, nimi)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(sis, f, ensure_ascii=False, separators=(",", ":"))
        koko = os.path.getsize(p)
        yht += koko
        print(f"  {nimi}: {len(sis.get('ajat', []))} aikaa, {koko // 1024} kt")
    p = os.path.join(kansio, "meri.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(hakemisto, f, ensure_ascii=False, separators=(",", ":"))
    yht += os.path.getsize(p)
    print(f"Kirjoitettu {p} ja {len(tiedostot)} päivätiedostoa, yhteensä {yht // 1024} kt (pakkaamatta)")


# ---------------------------------------------------------------- Copernicus-haut

def avaa(lahde, alku, loppu, syvyys=None, alue=None):
    import copernicusmarine
    ALUE = alue or globals()["ALUE"]
    virheet = []
    for ds_id in lahde["ehdokkaat"]:
        try:
            kw = dict(dataset_id=ds_id, variables=lahde["muuttujat"],
                      minimum_latitude=ALUE["lat_min"], maximum_latitude=ALUE["lat_max"],
                      minimum_longitude=ALUE["lon_min"], maximum_longitude=ALUE["lon_max"],
                      start_datetime=alku.strftime("%Y-%m-%dT%H:%M:%S"),
                      end_datetime=loppu.strftime("%Y-%m-%dT%H:%M:%S"))
            if syvyys:
                kw.update(minimum_depth=syvyys[0], maximum_depth=syvyys[1])
            try:
                return copernicusmarine.open_dataset(coordinates_selection_method="inside", **kw), ds_id
            except TypeError:
                return copernicusmarine.open_dataset(**kw), ds_id
        except Exception as e:  # noqa: BLE001
            virheet.append(f"{ds_id}: {e}")
    # Apua korjaukseen: listataan tuotteen datasetit lokiin
    try:
        import copernicusmarine
        kat = copernicusmarine.describe(product_id=lahde["tuote"])
        print("Tuotteen", lahde["tuote"], "datasetit:", file=sys.stderr)
        for p in getattr(kat, "products", []):
            for d in getattr(p, "datasets", []):
                print("  ", getattr(d, "dataset_id", d), file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print("describe epäonnistui:", e, file=sys.stderr)
    raise RuntimeError(" | ".join(virheet))


def hae_phy(nyt, alue=None):
    ds, ds_id = avaa(LAHTEET["phy"], nyt - timedelta(hours=TUNNIT_TAAKSE), nyt + timedelta(hours=TUNNIT_ETEEN),
                     syvyys=(0, SYVYYS_MAX), alue=alue)
    ds = ds.isel(time=tasatunnit(ds["time"].values))
    th = ds["thetao"]
    if "depth" not in th.dims:  # varmuuden vuoksi: yksi taso
        th = th.expand_dims("depth", axis=1)
    th = th.transpose("time", "depth", "latitude", "longitude")
    syv = ds["depth"].values if "depth" in ds.coords else np.array([0.5])
    u, v = ds["uo"], ds["vo"]
    u3 = v3 = None
    if "depth" in u.dims:
        jarj = ("time", "depth", "latitude", "longitude")
        u3, kuvaus = taso_syvyydella(u.transpose(*jarj).values, syv, VIRTA_SYV)
        v3, _ = taso_syvyydella(v.transpose(*jarj).values, syv, VIRTA_SYV)
        print(f"phy virta {VIRTA_SYV:g} m:", kuvaus)
        u, v = u.isel(depth=0), v.isel(depth=0)
    else:
        print(f"phy virta {VIRTA_SYV:g} m: ei syvyystasoja, vain pintavirta")
    print("phy syvyystasot (m):", ", ".join(f"{d:.2f}" for d in np.atleast_1d(syv)))
    return dict(dataset=ds_id, ajat=ds["time"].values, lat=ds["latitude"].values, lon=ds["longitude"].values,
                syvyydet=np.atleast_1d(syv), thetao=th.values,
                u=u.transpose("time", "latitude", "longitude").values,
                v=v.transpose("time", "latitude", "longitude").values, u3=u3, v3=v3)


def hae_wav(nyt, alue=None):
    lahde, alku, loppu = LAHTEET["wav"], nyt - timedelta(hours=TUNNIT_TAAKSE), nyt + timedelta(hours=TUNNIT_ETEEN)
    # v29/v30 (Hannu 14.–15.11.2026): jaksot mukaan; jos ne eivät onnistu, haetaan vähemmällä (aallonkorkeus ei saa kadota)
    lisa = lahde.get("lisa", [])
    yritykset = [lisa[:k] for k in range(len(lisa), -1, -1)]   # [VTM10, VTPK] → [VTM10] → []
    for n, ekstra in enumerate(yritykset):
        try:
            ds, ds_id = avaa(dict(lahde, muuttujat=lahde["muuttujat"] + ekstra), alku, loppu, alue=alue)
            break
        except Exception as e:  # noqa: BLE001
            if n == len(yritykset) - 1:
                raise
            print("wav: muuttujat", ekstra, "eivät onnistuneet, haetaan vähemmällä:", e, file=sys.stderr)
    ds = ds.isel(time=tasatunnit(ds["time"].values))
    return dict(dataset=ds_id, ajat=ds["time"].values, lat=ds["latitude"].values, lon=ds["longitude"].values,
                hs=ds["VHM0"].values, suunta=ds["VMDR"].values if "VMDR" in ds else None,
                jakso=ds["VTM10"].values if "VTM10" in ds else None,
                huippu=ds["VTPK"].values if "VTPK" in ds else None)


def pinta2d(da):
    """v43: muuttuja (time, [depth], lat, lon) -> numpy (time, lat, lon); syvyystasoista ylin."""
    if "depth" in getattr(da, "dims", ()):
        da = da.isel(depth=0)
    return np.ma.filled(np.ma.asarray(da.transpose("time", "latitude", "longitude").values, dtype=float), np.nan)


def hae_bgc(nyt, alue=None, lisa=None):
    """v43: kd ja zsd päiväaineistosta; jos toinen ei onnistu, haetaan pelkkä toinen.
    v54: lisa (esim. ["o2b"] = pohjan happi, mmol/m3) yritetään ensin mukaan; jos ei onnistu, haetaan ilman."""
    lahde, alku, loppu = LAHTEET["bgc"], nyt - timedelta(days=1), nyt + timedelta(days=10)
    virhe = None
    yritykset = ([["kd", "zsd"] + list(lisa)] if lisa else []) + [["kd", "zsd"], ["kd"], ["zsd"]]
    for muuttujat in yritykset:
        try:
            ds, ds_id = avaa(dict(lahde, muuttujat=muuttujat), alku, loppu, alue=alue)
            break
        except Exception as e:  # noqa: BLE001
            virhe = e
            print("bgc: muuttujat", muuttujat, "eivät onnistuneet:", e, file=sys.stderr)
    else:
        raise RuntimeError(f"bgc: {virhe}")
    tulos = dict(dataset=ds_id, ajat=ds["time"].values, lat=ds["latitude"].values, lon=ds["longitude"].values, kd=None, zsd=None, o2b=None)
    for k in ("kd", "zsd", "o2b"):
        if k in ds:
            tulos[k] = pinta2d(ds[k])
    print("bgc:", ", ".join(f"{k} {np.nanmin(tulos[k]):.3f}–{np.nanmax(tulos[k]):.3f}" for k in ("kd", "zsd", "o2b")
                             if tulos[k] is not None and np.isfinite(tulos[k]).any()))
    return tulos


def hae_kerros(nyt, alue=None):
    """v48: pohjan lämpö (bottomT) ja sekoittumiskerros (mlotst), sama aikajakso kuin lämmöllä; 3 h välein.
    Jos molemmat yhdessä eivät onnistu, haetaan kumpikin erikseen. Palauttaa dict(dataset, ajat, lat, lon, pt, mld)."""
    lahde, alku, loppu = LAHTEET["kerros"], nyt - timedelta(hours=TUNNIT_TAAKSE), nyt + timedelta(hours=TUNNIT_ETEEN)
    virhe = None
    for muuttujat in (["bottomT", "mlotst"], ["bottomT"], ["mlotst"]):
        try:
            ds, ds_id = avaa(dict(lahde, muuttujat=muuttujat), alku, loppu, alue=alue)
            break
        except Exception as e:  # noqa: BLE001
            virhe = e
            print("kerros: muuttujat", muuttujat, "eivät onnistuneet:", str(e)[:300], file=sys.stderr)
    else:
        raise RuntimeError(f"kerros: {virhe}")
    ds = ds.isel(time=tasatunnit(ds["time"].values))
    tulos = dict(dataset=ds_id, ajat=ds["time"].values, lat=ds["latitude"].values, lon=ds["longitude"].values,
                 pt=pinta2d(ds["bottomT"]) if "bottomT" in ds else None, mld=pinta2d(ds["mlotst"]) if "mlotst" in ds else None)
    print("kerros:", ds_id, len(tulos["ajat"]), "aikaa;", ", ".join(f"{k} {np.nanmin(tulos[k]):.1f}–{np.nanmax(tulos[k]):.1f}"
                                                                    for k in ("pt", "mld") if tulos[k] is not None and np.isfinite(tulos[k]).any()))
    return tulos


def hae_pohja(alue=None):
    """v43: mallin pohjan syvyys (deptho) staattisesta aineistosta. Aikarajausta ei ole; osa (dataset_part) kokeillaan."""
    import copernicusmarine
    A = alue or ALUE
    virheet = []
    for ds_id in LAHTEET["pohja"]["ehdokkaat"]:
        for osa in ("bathy", None):
            kw = dict(dataset_id=ds_id, variables=["deptho"], minimum_latitude=A["lat_min"], maximum_latitude=A["lat_max"],
                      minimum_longitude=A["lon_min"], maximum_longitude=A["lon_max"])
            if osa:
                kw["dataset_part"] = osa
            try:
                ds = copernicusmarine.open_dataset(**kw)
                d = np.ma.filled(np.ma.asarray(ds["deptho"].transpose("latitude", "longitude").values, dtype=float), np.nan)
                print(f"pohja: {ds_id}{' / ' + osa if osa else ''}, {np.nanmin(d):.1f}–{np.nanmax(d):.1f} m")
                return dict(dataset=ds_id, lat=ds["latitude"].values, lon=ds["longitude"].values, deptho=d)
            except Exception as e:  # noqa: BLE001
                virheet.append(f"{ds_id}{'/' + osa if osa else ''}: {str(e)[:150]}")
    raise RuntimeError(" | ".join(virheet))


def hae_sst(nyt, alue=None):
    ds, ds_id = avaa(LAHTEET["sst"], nyt - timedelta(days=3), nyt, alue=alue)
    ds = ds.isel(time=[-1])  # viimeisin päivä
    arvot = ds["analysed_sst"].values
    if np.nanmean(arvot) > 200:  # kelvin -> °C
        arvot = arvot - 273.15
    return {"dataset": ds_id, "lat": pyorista(ds["latitude"].values, 4), "lon": pyorista(ds["longitude"].values, 4),
            "ajat": [iso(t) for t in ds["time"].values], "lampo": pyorista(arvot, 2)}


# ---------------------------------------------------------------- edellisen ajon data

def sivun_osoite():
    repo = os.environ.get("GITHUB_REPOSITORY", "Lohirosvo/merilohitutka")
    omistaja, nimi = repo.split("/", 1)
    return f"https://{omistaja.lower()}.github.io/{nimi}/data/"


def lue_vanha(polku):
    try:
        with open(polku, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def hae_vanha_sivulta(osoite):
    try:
        with urllib.request.urlopen(osoite + "meri.json", timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def palauta_edelliset(kansio, vanha, osoite=None):
    """Ladataan edellisen ajon päivätiedostot julkaistulta sivulta ja kirjoitetaan edellinen meri.json."""
    osoite = osoite or sivun_osoite()
    if not vanha or "paivat" not in vanha:
        print("Edellistä päivätiedostoaineistoa ei ole.", file=sys.stderr)
        return
    with open(os.path.join(kansio, "meri.json"), "w", encoding="utf-8") as f:
        json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
    for p in vanha["paivat"]:
        try:
            with urllib.request.urlopen(osoite + p["tiedosto"], timeout=30) as r, \
                    open(os.path.join(kansio, p["tiedosto"]), "wb") as f:
                f.write(r.read())
        except Exception as e:  # noqa: BLE001
            print("Edellisen tiedoston lataus epäonnistui:", p["tiedosto"], e, file=sys.stderr)
    print("Edellisen ajon data jätetään voimaan.", file=sys.stderr)


def lue_alueet(tiedosto=None):
    """Alueet tiedostosta alueet.js (JSON-taulukko kohdan 'ALUEET = ' jälkeen). Puuttuessa vain Luoto."""
    tiedosto = tiedosto or os.path.join(os.path.dirname(os.path.abspath(__file__)), "alueet.js")
    try:
        with open(tiedosto, encoding="utf-8") as f:
            t = f.read()
        alku = t.index("[", t.index("ALUEET = "))
        alueet = json.loads(t[alku:t.rindex("]") + 1])
        print("Alueet:", ", ".join(f"{a['tunnus']} ({a['polku'] or 'data/'})" for a in alueet))
        return alueet
    except Exception as e:  # noqa: BLE001
        print(f"alueet.js ei luettavissa ({e}) – haetaan vain Luoto", file=sys.stderr)
        return [{"tunnus": "luoto", "nimi": "Luoto–Tankar", "polku": "", "rajat": dict(ALUE)}]


def hae_alue(alue, perus, nyt, luotu):
    """Yksi alue kansioon perus/<polku>. Palauttaa True, jos fysiikkamallin data saatiin."""
    import hae_tuuli
    tunnus, rajat = alue["tunnus"], alue["rajat"]
    kansio = os.path.join(perus, alue.get("polku", ""))
    os.makedirs(kansio, exist_ok=True)
    osoite = sivun_osoite() + alue.get("polku", "")
    print(f"===== Alue {tunnus}: {alue.get('nimi', tunnus)} {rajat}")
    vanha = lue_vanha(os.path.join(kansio, "meri.json")) if not alue.get("polku") else None
    vanha = vanha or hae_vanha_sivulta(osoite)   # julkaise.yml ottaa talteen vain data/meri.json:n
    syvyys = vaylat = tuuli = None
    try:  # Traficomin syvyyskäyrät (harvoin muuttuvat); virhe ei saa kaataa Copernicus-hakua
        import hae_syvyys
        alku = time.monotonic()
        syvyys = hae_syvyys.paivita(kansio, osoite, alue=rajat)
        print(f"syvyys: {syvyys.get('tila')}, {time.monotonic() - alku:.0f} s")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        syvyys = {"tila": "virhe", "viesti": f"{e}"[:300]}
    try:  # Väyläviraston väylät (harvoin muuttuvat)
        import hae_vaylat
        alku = time.monotonic()
        vaylat = hae_vaylat.paivita(kansio, osoite, alue=rajat)
        print(f"väylät: {vaylat.get('tila')}, {time.monotonic() - alku:.0f} s")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        vaylat = {"tila": "virhe", "viesti": f"{e}"[:300]}
    tulokset, virheet = {}, []
    for nimi, hakija in (("phy", hae_phy), ("wav", hae_wav), ("sst", hae_sst)):
        alku = time.monotonic()
        try:
            tulokset[nimi] = hakija(nyt, rajat)
            t = tulokset[nimi]
            ajat = t["ajat"]
            nayta = (lambda a: a if isinstance(a, str) else iso(np.datetime64(a)))
            vali = f"{nayta(ajat[0])} … {nayta(ajat[-1])}" if len(ajat) else "-"
            print(f"{nimi}: OK {t['dataset']}, {len(ajat)} aikaa ({vali}), {len(t['lat'])}x{len(t['lon'])} ruutua, "
                  f"{time.monotonic() - alku:.0f} s")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            virheet.append(f"{nimi}: {str(e)[:300]}")
            print(f"{nimi}: VIRHE {e}", file=sys.stderr)

    if "phy" not in tulokset:
        print(f"Alue {tunnus}: fysiikkamallin haku epäonnistui – vanha data jätetään paikalleen.", file=sys.stderr)
        palauta_edelliset(kansio, vanha, osoite)
        return False

    sst = tulokset.get("sst")
    if sst is None and vanha and vanha.get("sst"):
        sst = vanha["sst"]
        virheet.append("sst: käytetään edellistä")
    try:  # IL:n tuuliennuste kartan pisteisiin, sama aikajakso kuin Copernicuksella
        alku = time.monotonic()
        a = tulokset["phy"]["ajat"]
        pisteet = alue.get("tuulipisteet")
        if not pisteet or alue.get("tuulipisteetLisaa"):   # mallin meriruuduista (aallot, muuten pintalämpö)
            w = tulokset.get("wav")
            if w is not None:
                meri = np.isfinite(np.asarray(w["hs"])[0])
                auto = hae_tuuli.meripisteet(w["lat"], w["lon"], meri)
            else:
                p = tulokset["phy"]
                auto = hae_tuuli.meripisteet(p["lat"], p["lon"], np.isfinite(np.asarray(p["thetao"])[0, 0]))
            if not pisteet:
                pisteet = auto
                print(f"tuuli: pisteet mallin meriruuduista ({len(pisteet)} kpl)")
            else:   # v22: kiinteät + meriruuduista ne, jotka ovat yli 10 km:n päässä kiinteistä (laajennettu alue)
                kiinteat = len(pisteet)
                pisteet = hae_tuuli.taydenna(pisteet, auto)
                print(f"tuuli: {kiinteat} kiinteää pistettä + {len(pisteet) - kiinteat} mallin meriruuduista: "
                      + ", ".join(f"{la:.3f} {lo:.3f}" for la, lo in pisteet[kiinteat:]))
        tuuli, tvirhe = hae_tuuli.hae(iso(np.datetime64(a[0])), iso(np.datetime64(a[-1])), pisteet=pisteet)
        if tvirhe:
            virheet.append(f"tuuli: {tvirhe}")
        print(f"tuuli: {'OK' if tuuli else 'VIRHE'}, {time.monotonic() - alku:.0f} s")
        if tuuli and alue.get("silakka"):   # v44: pilvisyys silakan valomalliin, vain silakka-alueille
            try:
                pc, pvirhe = hae_tuuli.hae_pilvi(tuuli["ajat"], tuuli["pisteet"])
                if pc:
                    tuuli["pc"] = pc
                else:
                    virheet.append(f"pilvi: {pvirhe}")
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                virheet.append(f"pilvi: {str(e)[:200]}")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        virheet.append(f"tuuli: {str(e)[:200]}")
    bgc = pohja = kerros = None
    vanha_pohja = vanha.get("pohja") if vanha else None
    if alue.get("silakka"):   # v43: silakan valokerros (kohta 1.1): valon vaimennus; mallin pohja kerran (ei muutu)
        lisa = ["o2b"] if alue["silakka"].get("happi") else None   # v54: kilohaili (Eckerö) tarvitsee pohjan hapen
        hakijat = [("bgc", lambda: hae_bgc(nyt, rajat, lisa)), ("kerros", lambda: hae_kerros(nyt, rajat))] \
            + ([] if vanha_pohja else [("pohja", lambda: hae_pohja(rajat))])
        for nimi, hakija in hakijat:
            alku = time.monotonic()
            try:
                t = hakija()
                if nimi == "bgc":
                    bgc = t
                    print(f"bgc: OK {t['dataset']}, {len(t['ajat'])} päivää, {len(t['lat'])}x{len(t['lon'])} ruutua, "
                          f"{time.monotonic() - alku:.0f} s")
                elif nimi == "kerros":
                    kerros = t
                    print(f"kerros: OK, {time.monotonic() - alku:.0f} s")
                else:
                    pohja = t
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                virheet.append(f"{nimi}: {str(e)[:300]}")
                print(f"{nimi}: VIRHE {e}", file=sys.stderr)
        if vanha_pohja:
            print("pohja: edellisestä ajosta (staattinen)")
    hakemisto, tiedostot = rakenna(tulokset["phy"], tulokset.get("wav"), sst, luotu, virheet, syvyys, tuuli, vaylat, rajat,
                                   bgc=bgc, pohja=pohja, kerros=kerros)
    if alue.get("silakka") and vanha_pohja and "pohja" not in hakemisto:
        hakemisto["pohja"] = vanha_pohja
    hakemisto["tunnus"], hakemisto["nimi"] = tunnus, alue.get("nimi", tunnus)
    kirjoita(kansio, hakemisto, tiedostot)
    return True


def main(polku):
    perus = os.path.dirname(polku) or "."
    nyt = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    luotu = iso(datetime.now(timezone.utc))  # todellinen hakuhetki (näytetään käyttäjälle)
    onnistui = []
    for alue in lue_alueet():
        alku = time.monotonic()
        try:
            ok = hae_alue(alue, perus, nyt, luotu)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            print(f"Alue {alue.get('tunnus')}: VIRHE {e}", file=sys.stderr)
            ok = False
        onnistui.append(ok)
        print(f"===== Alue {alue.get('tunnus')}: {'OK' if ok else 'VIRHE'}, {time.monotonic() - alku:.0f} s")
    if not all(onnistui):
        sys.exit(1)   # lokiin punainen merkki; julkaisu tehdään silti (continue-on-error)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "meri.json")
