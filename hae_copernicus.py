"""Merilohitutka – hae_copernicus.py

Hakee Copernicus Marinesta Uusikaarlepyy–Tankar-alueen meridatan ja kirjoittaa sen
pieneksi JSON-tiedostoksi sovellusta varten. Ajetaan GitHub Actionsissa (julkaise.yml).

Tunnus luetaan ympäristömuuttujista COPERNICUSMARINE_SERVICE_USERNAME ja
COPERNICUSMARINE_SERVICE_PASSWORD (GitHubin salaisuudet).

Käyttö:  python hae_copernicus.py polku/meri.json
"""
import json
import math
import sys
import traceback
from datetime import datetime, timedelta, timezone

import numpy as np

# Alue: Uusikaarlepyy (63,5) – Tankar (63,95), länteen avomerelle
ALUE = dict(lat_min=63.45, lat_max=64.05, lon_min=22.05, lon_max=23.10)
TUNNIT_TAAKSE = 3
TUNNIT_ETEEN = 48
ASKEL_H = 3  # tuntiaskel tiedostoon (koko pysyy pienenä)

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
    """numpy-taulukko -> sisäkkäinen lista; NaN -> None."""
    a = np.asarray(taulukko, dtype=float)
    a = np.round(a, desimaalit)
    lista = a.tolist()

    def korjaa(x):
        if isinstance(x, list):
            return [korjaa(y) for y in x]
        return None if (x is None or (isinstance(x, float) and math.isnan(x))) else x
    return korjaa(lista)


def iso(t):
    """numpy datetime64 / datetime -> 'YYYY-MM-DDTHH:MM:SSZ'."""
    if isinstance(t, np.datetime64):
        t = t.astype("datetime64[s]").astype(datetime).replace(tzinfo=timezone.utc)
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ruudukko(lat, lon, ajat, kentat, desimaalit):
    """Yksi lähde JSON-muotoon. kentat: {nimi: array[aika, lat, lon]}"""
    return {
        "lat": pyorista(lat, 4),
        "lon": pyorista(lon, 4),
        "ajat": [iso(t) for t in ajat],
        **{nimi: pyorista(arvo, desimaalit[nimi]) for nimi, arvo in kentat.items()},
    }


# ---------------------------------------------------------------- Copernicus-haut

def avaa(lahde, alku, loppu, syvyys=False):
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
                kw.update(minimum_depth=0, maximum_depth=2)
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


def koordinaatit(ds):
    lat = ds["latitude"].values
    lon = ds["longitude"].values
    return lat, lon


def hae_phy(nyt):
    ds, ds_id = avaa(LAHTEET["phy"], nyt - timedelta(hours=TUNNIT_TAAKSE), nyt + timedelta(hours=TUNNIT_ETEEN), syvyys=True)
    if "depth" in ds.dims:
        ds = ds.isel(depth=0)
    ds = ds.isel(time=slice(None, None, ASKEL_H))
    lat, lon = koordinaatit(ds)
    kentat = {"lampo": ds["thetao"].values, "u": ds["uo"].values, "v": ds["vo"].values}
    out = ruudukko(lat, lon, ds["time"].values, kentat, {"lampo": 2, "u": 3, "v": 3})
    out["dataset"] = ds_id
    return out


def hae_wav(nyt):
    ds, ds_id = avaa(LAHTEET["wav"], nyt - timedelta(hours=TUNNIT_TAAKSE), nyt + timedelta(hours=TUNNIT_ETEEN))
    ds = ds.isel(time=slice(None, None, ASKEL_H))
    lat, lon = koordinaatit(ds)
    kentat = {"hs": ds["VHM0"].values}
    des = {"hs": 2}
    if "VMDR" in ds:
        kentat["suunta"] = ds["VMDR"].values
        des["suunta"] = 0
    out = ruudukko(lat, lon, ds["time"].values, kentat, des)
    out["dataset"] = ds_id
    return out


def hae_sst(nyt):
    ds, ds_id = avaa(LAHTEET["sst"], nyt - timedelta(days=3), nyt)
    ds = ds.isel(time=[-1])  # viimeisin päivä
    lat, lon = koordinaatit(ds)
    arvot = ds["analysed_sst"].values
    if np.nanmean(arvot) > 200:  # kelvin -> °C
        arvot = arvot - 273.15
    out = ruudukko(lat, lon, ds["time"].values, {"lampo": arvot}, {"lampo": 2})
    out["dataset"] = ds_id
    return out


def main(polku):
    nyt = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    # luotu = todellinen hakuhetki (näytetään käyttäjälle); nyt = tasatunti hakuikkunalle
    tulos = {"luotu": iso(datetime.now(timezone.utc)), "alue": ALUE, "virheet": [],
             "lisenssi": "E.U. Copernicus Marine Service Information"}
    for nimi, hakija in (("phy", hae_phy), ("wav", hae_wav), ("sst", hae_sst)):
        try:
            tulos[nimi] = hakija(nyt)
            print(f"{nimi}: OK {tulos[nimi]['dataset']}, {len(tulos[nimi]['ajat'])} aikaa, "
                  f"{len(tulos[nimi]['lat'])}x{len(tulos[nimi]['lon'])} ruutua")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            tulos["virheet"].append(f"{nimi}: {str(e)[:300]}")
            print(f"{nimi}: VIRHE {e}", file=sys.stderr)
    if not any(k in tulos for k in ("phy", "wav", "sst")):
        print("Mikään haku ei onnistunut – vanha data jätetään paikalleen.", file=sys.stderr)
        sys.exit(1)
    with open(polku, "w", encoding="utf-8") as f:
        json.dump(tulos, f, ensure_ascii=False, separators=(",", ":"))
    print("Kirjoitettu", polku)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "meri.json")
