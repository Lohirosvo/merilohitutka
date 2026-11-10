"""Merilohitutka – hae_copernicus.py (v9)

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

# Tuote-ID:t ja muuttujat. Jos tunnus on väärä, skripti tulostaa lokiin Itämeren datasetit.
LAHTEET = {
    "phy": dict(tuote="BALTICSEA_ANALYSISFORECAST_PHY_003_006",
                ehdokkaat=["cmems_mod_bal_phy_anfc_PT1H-i"],
                muuttujat=["thetao", "uo", "vo"]),
    "wav": dict(tuote="BALTICSEA_ANALYSISFORECAST_WAV_003_010",
                ehdokkaat=["cmems_mod_bal_wav_anfc_PT1H-i"],
                muuttujat=["VHM0", "VMDR"]),
    "sst": dict(tuote="SST_BAL_SST_L4_NRT_OBSERVATIONS_010_007_b",
                ehdokkaat=["DMI-BALTIC-SST-L4-NRT-OBS_FULL_TIME_SERIE"],
                muuttujat=["analysed_sst"]),
}


# ---------------------------------------------------------------- muunnos (testattava ilman verkkoa)

def pyorista(taulukko, desimaalit):
    """numpy-taulukko -> sisäkkäinen lista liukulukuja; NaN -> None."""
    a = np.round(np.asarray(taulukko, dtype=float), desimaalit)
    o = a.astype(object)
    o[~np.isfinite(a)] = None
    return o.tolist()


def kokonaisluvut(taulukko, kerroin=KERROIN):
    """numpy-taulukko -> sisäkkäinen lista kokonaislukuja (arvo × kerroin); NaN -> None."""
    a = np.asarray(taulukko, dtype=float) * kerroin
    ok = np.isfinite(a)
    i = np.where(ok, np.round(a), 0).astype(np.int64).astype(object)
    i[~ok] = None
    return i.tolist()


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


def rakenna(phy, wav, sst, luotu, virheet, syvyys=None, tuuli=None, vaylat=None):
    """Kokoaa hakemiston ja päivätiedostot.
    phy = dict(ajat, lat, lon, syvyydet, thetao[aika, syvyys, lat, lon], u[aika, lat, lon], v, dataset)
    wav = dict(ajat, lat, lon, hs[aika, lat, lon], suunta, dataset) tai None
    sst = valmis JSON-osa tai None
    Palauttaa (hakemisto, {tiedostonimi: sisältö})."""
    hakemisto = {"muoto": 2, "luotu": luotu, "alue": ALUE, "virheet": list(virheet),
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
    if wav:
        hakemisto["wav"] = {"dataset": wav["dataset"], "lat": pyorista(wav["lat"], 4), "lon": pyorista(wav["lon"], 4)}
    if sst:
        hakemisto["sst"] = sst

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
        iw = w_paivat.get(pvm, [])
        if iw:
            w = {"ajat": [iso(np.datetime64(wav["ajat"][i])) for i in iw],
                 "hs": kokonaisluvut(np.asarray(wav["hs"])[iw])}
            if wav.get("suunta") is not None:
                w["suunta"] = kokonaisluvut(np.asarray(wav["suunta"])[iw], 1)
            sis["wav"] = w
        if "ajat" not in sis:
            sis["ajat"] = w["ajat"] if iw else []
        it = t_paivat.get(pvm, [])
        if it:
            sis["tuuli"] = {"ajat": [tuuli["ajat"][i] for i in it],
                            **{k: [tuuli[k][i] for i in it] for k in ("ws", "wd", "wg")}}
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

def avaa(lahde, alku, loppu, syvyys=None):
    import copernicusmarine
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


def hae_phy(nyt):
    ds, ds_id = avaa(LAHTEET["phy"], nyt - timedelta(hours=TUNNIT_TAAKSE), nyt + timedelta(hours=TUNNIT_ETEEN),
                     syvyys=(0, SYVYYS_MAX))
    ds = ds.isel(time=tasatunnit(ds["time"].values))
    th = ds["thetao"]
    if "depth" not in th.dims:  # varmuuden vuoksi: yksi taso
        th = th.expand_dims("depth", axis=1)
    th = th.transpose("time", "depth", "latitude", "longitude")
    syv = ds["depth"].values if "depth" in ds.coords else np.array([0.5])
    u, v = ds["uo"], ds["vo"]
    if "depth" in u.dims:
        u, v = u.isel(depth=0), v.isel(depth=0)
    print("phy syvyystasot (m):", ", ".join(f"{d:.2f}" for d in np.atleast_1d(syv)))
    return dict(dataset=ds_id, ajat=ds["time"].values, lat=ds["latitude"].values, lon=ds["longitude"].values,
                syvyydet=np.atleast_1d(syv), thetao=th.values,
                u=u.transpose("time", "latitude", "longitude").values,
                v=v.transpose("time", "latitude", "longitude").values)


def hae_wav(nyt):
    ds, ds_id = avaa(LAHTEET["wav"], nyt - timedelta(hours=TUNNIT_TAAKSE), nyt + timedelta(hours=TUNNIT_ETEEN))
    ds = ds.isel(time=tasatunnit(ds["time"].values))
    return dict(dataset=ds_id, ajat=ds["time"].values, lat=ds["latitude"].values, lon=ds["longitude"].values,
                hs=ds["VHM0"].values, suunta=ds["VMDR"].values if "VMDR" in ds else None)


def hae_sst(nyt):
    ds, ds_id = avaa(LAHTEET["sst"], nyt - timedelta(days=3), nyt)
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


def palauta_edelliset(kansio, vanha):
    """Ladataan edellisen ajon päivätiedostot julkaistulta sivulta (meri.json on jo talteen otettu)."""
    if not vanha or "paivat" not in vanha:
        print("Edellistä päivätiedostoaineistoa ei ole.", file=sys.stderr)
        return
    for p in vanha["paivat"]:
        try:
            with urllib.request.urlopen(sivun_osoite() + p["tiedosto"], timeout=30) as r, \
                    open(os.path.join(kansio, p["tiedosto"]), "wb") as f:
                f.write(r.read())
        except Exception as e:  # noqa: BLE001
            print("Edellisen tiedoston lataus epäonnistui:", p["tiedosto"], e, file=sys.stderr)
    print("Edellisen ajon data jätetään voimaan.", file=sys.stderr)


def main(polku):
    kansio = os.path.dirname(polku) or "."
    vanha = lue_vanha(polku)  # julkaise.yml on ottanut edellisen meri.json:n talteen tähän
    syvyys = vaylat = tuuli = None
    try:  # Traficomin syvyyskäyrät (harvoin muuttuvat); virhe ei saa kaataa Copernicus-hakua
        import hae_syvyys
        alku = time.monotonic()
        syvyys = hae_syvyys.paivita(kansio, sivun_osoite())
        print(f"syvyys: {syvyys.get('tila')}, {time.monotonic() - alku:.0f} s")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        syvyys = {"tila": "virhe", "viesti": f"{e}"[:300]}
    try:  # Väyläviraston väylät (harvoin muuttuvat)
        import hae_vaylat
        alku = time.monotonic()
        vaylat = hae_vaylat.paivita(kansio, sivun_osoite())
        print(f"väylät: {vaylat.get('tila')}, {time.monotonic() - alku:.0f} s")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        vaylat = {"tila": "virhe", "viesti": f"{e}"[:300]}
    nyt = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    luotu = iso(datetime.now(timezone.utc))  # todellinen hakuhetki (näytetään käyttäjälle)
    tulokset, virheet = {}, []
    for nimi, hakija in (("phy", hae_phy), ("wav", hae_wav), ("sst", hae_sst)):
        alku = time.monotonic()
        try:
            tulokset[nimi] = hakija(nyt)
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
        print("Fysiikkamallin haku epäonnistui – vanha data jätetään paikalleen.", file=sys.stderr)
        palauta_edelliset(kansio, vanha)
        sys.exit(1)

    sst = tulokset.get("sst")
    if sst is None and vanha and vanha.get("sst"):
        sst = vanha["sst"]
        virheet.append("sst: käytetään edellistä")
    try:  # IL:n tuuliennuste kartan pisteisiin, sama aikajakso kuin Copernicuksella
        import hae_tuuli
        alku = time.monotonic()
        a = tulokset["phy"]["ajat"]
        tuuli, tvirhe = hae_tuuli.hae(iso(np.datetime64(a[0])), iso(np.datetime64(a[-1])))
        if tvirhe:
            virheet.append(f"tuuli: {tvirhe}")
        print(f"tuuli: {'OK' if tuuli else 'VIRHE'}, {time.monotonic() - alku:.0f} s")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        virheet.append(f"tuuli: {str(e)[:200]}")
    hakemisto, tiedostot = rakenna(tulokset["phy"], tulokset.get("wav"), sst, luotu, virheet, syvyys, tuuli, vaylat)
    kirjoita(kansio, hakemisto, tiedostot)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "meri.json")
