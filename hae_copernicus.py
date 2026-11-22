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

v71 (22.11.2026, Hannu "A … tuleehan selkeä viiva missä raja menee?"): alueille, joilla "lohirajat": true, haetaan valtion
yleinen vesialue (kiinteistötunnus kunta-894-…) MML:n Kiinteistötietojen kyselypalvelusta (hae_vesialueet.py, vesialueet.json
alueen kansioon, uusinta 30 vrk). Avain GitHubin salaisuudesta MML_API_KEY (julkaise.yml välittää); ilman avainta käytetään
julkaistua tiedostoa. v68:n koeajo (koe_vesialueet.py) poistettu ajosta: tulos selvä (INSPIRE-tuotteessa ei vesialueita).

v68 (22.11.2026, Hannu "Tehdään koeajo"): koe_vesialueet.py ajetaan lopuksi kerran vuorokaudessa: tunnistuuko valtion yleinen
vesialue Maanmittauslaitoksen avoimesta INSPIRE-kiinteistöaineistosta. Vain loki ja data/vesialue_koe.json, ei karttaa.

v67 (22.11.2026, Hannu "Saako kartalle sen lohen kalastusviivan missä raja kulkee … Tehdään, ei viivaa ahvenanmaalle"):
alueille, joilla alueet.js:ssä "lohirajat": true, haetaan Traficomin perusviiva ja lasketaan 4 mpk:n raja (hae_rajat.py,
rajat.json alueen kansioon, uusinta 90 vrk). Virhe ei vaikuta muuhun hakuun.

v66 (22.11.2026, Hannu "Itse hyväksyisin 59 päivää"): lomadatan kesä hyväksytään, kun tuulipäiviä on vähintään
LOMA_TUULI_MIN = 59 (ennen 60; raja on arvio, ei lähteestä). Ajon #103 mukaan 2022:ssa on 59 tuulipäivää → kesä haettiin
turhaan joka päivä. Puuttuvat päivät ovat laskennassa tuntemattomia (ikaluokat.js lomaVuosi: tuuli null, jos alle puolet
tunneista). REP_KORJAUS "v66" nollaa yritetty-merkinnät kerran → 2022 haetaan jo latauksen käynnistämässä ajossa.

v65 (22.11.2026, Hannu "tehdään korjaus mikä on tarpeen"): 1) REP-pintalämmön tunnus vaihtunut: ajon #101 lokin
mukaan tuotteessa SST_BAL_SST_L4_REP_OBSERVATIONS_010_016 on nyt vain cmems_obs-sst_bal_phy-temp_my_l4_P1D-m (versio
202511) → uusi tunnus ensin, vanha varalla; jos muuttujaa "analysed_sst" ei ole, avataan ilman muuttujarajausta ja
lämpö valitaan nimestä. Vuodet 2016–2023 yritetään heti uudelleen (yritetty-merkinnät nollataan kerran, REP_KORJAUS).
2) Jockfall: laskenta on päättynyt tältä vuodelta ("Fiskräkning Jockfall, Kalixälven är nu avslutad"). Sivulla on silloin
otsikko ilman "i <joki>, <paikka>, <vuosi>" ja taulukossa vain rivi "TOTAL 2026" (WebFetch 22.11.2026: lax 15563) → ajon
#101 virhe "ei laskuritaulukoita". Nyt taulukko tunnistetaan väljemmin (Datum + Lax, laskuri sanasta Jockfall/Linafallet,
vuosi TOTAL-riviltä), kauden kokonaismäärä lajeittain laskurit.<avain>.kaudet.<vuosi>:iin, päivät edelleen vuodet-kohtaan.
Taulukoton "avslutad"-sivu ei ole virhe; tunnistamattomasta sivusta ote jokilaskurit.json:n tila-kohtaan. Merkistö otsakkeesta.

v64 (21.11.2026, Hannu "7 8 10 myös muikku silakka ahven taimen jos löytyy"): alueittain Luken VELMU-aineiston
silakan, muikun ja ahvenen mallinnetut poikastuotantoalueet kuvina (hae_lisaantyminen.py, kerran vuodessa).

v63 (21.11.2026, Hannu "2 4 5"): jokilaskurit. Länsstyrelsen Norrbottenin sivu näyttää Kalixälvenin Jockfallin ja
Linaälvenin laskurin kymmenen viimeisintä päivää HTML-taulukkona [L 21.11.2026] → päivät kerätään talteen
data/jokilaskurit.json (vanhat päivät säilyvät, uudet korvaavat). Luken Tornion- ja Simojoen laskureille ei löytynyt
avointa rajapintaa (sivu on JavaScript-sovellus), joten niitä ei haeta.

v62 (21.11.2026, Hannu "1 3 6 tehdään"): IL:n varoitussyöte (CAP/Atom, avoin data) talteen data/varoitukset.xml joka
ajossa. Sovellus hakee syötteen ensin suoraan ja käyttää tätä varalla (jos selain ei saa sitä suoraan tai verkko katkeaa).

v60 (17.11.2026, Hannu: "säädettävissä olevilla arvoilla … Vedenlämpö ja etäisyys 2-12 km. Vajaapäivä käy jos 5 h min
24-03 ei huomioida"): lomadata versio 2 = pintalämpö 11 pisteessä 2–12 km rannasta (1 km välein, länteen Kallanin
eteläpuolen rantapisteestä) ja tuntituulet (Suomen ajan tunnit 0–23, m/s × 10). Sovellus valitsee rajat. Versio 1 haetaan
uudelleen.

v59 (17.11.2026, Hannu: "Kallan … 20 m vesillä / noin 5 km rannasta 6-8 C … tuulet alle 8 m/s paras viikko. Käytä
toteutuneita tuulia ja veden pintalämpötiloja … lomaviikon valinta 2028"): data/lomadata.json = joka kesältä 2016– (1.5.–31.7.)
satelliitin pintalämpö pisteessä LOMA_PISTE (vrk-keskiarvo) ja Kallanin sääaseman tuuli (päiväsaikaan 6–20 tunnit, joina
10 min keskituuli tasatunnilla < 8 m/s). Vain puuttuvat kesät haetaan; edellinen tiedosto julkaistulta sivulta. Ajetaan
alueiden jälkeen; tiedosto kirjoitetaan jokaisen kesän jälkeen, jotta aikakatkaisu ei hukkaa jo haettua.

v57 (17.11.2026, silakkatietopohja v007 kohta 7.7): huhtikuun pintalämpö Trelleborg–Sassnitz-väliltä vuosille 2016–
viimeisin huhtikuu tiedostoon data/ikaluokat.json (sovelluksen ikäluokkaennuste). Edellinen tiedosto luetaan julkaistulta
sivulta, ja vain puuttuvat vuodet haetaan: 2016–2024 uusinta-ajosta (REP, 1.1.1982–31.12.2024), 2025– NRT-tuotteesta,
jonka arkisto on liukuva (10.8.2023–, data.marine.copernicus.eu 17.11.2026) – siksi arvot säilytetään tiedostossa.
Haku tehdään ennen alueita, eikä sen virhe estä alueiden hakua.

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
import math
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
    # v57: uusinta-ajo huhtikuiden vertailujaksoon (NRT-arkisto ei ulotu vuoteen 2016). Datasetin tunnus STAC-
    # metatiedosta (sextant.ifremer.fr), ei vielä kokeiltu ajossa: virheessä avaa() listaa tuotteen datasetit lokiin.
    # v65: tunnus vaihtunut [L, ajon #101 loki 22.11.2026: tuotteen ainoa datasetti cmems_obs-sst_bal_phy-temp_my_l4_P1D-m,
    # versio 202511]; vanha varalla. muuttuja_vapaa: jos muuttujarajaus kaatuu, avataan ilman (sst_kentta valitsee).
    "sst_rep": dict(tuote="SST_BAL_SST_L4_REP_OBSERVATIONS_010_016",
                    ehdokkaat=["cmems_obs-sst_bal_phy-temp_my_l4_P1D-m", "DMI_BAL_SST_L4_REP_OBSERVATIONS_010_016"],
                    muuttujat=["analysed_sst"], muuttuja_vapaa=True),
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
# v57: ikäluokkaennusteen huhtikuun lämpö. Paikka Trelleborg–Sassnitz [L49: Karlsson ym. 1994 regressio
# saalispäivä = 212 − 4,6 × huhtikuun lämpö]; laatikon rajat arvio [A]. Vähintään 25 päivää huhtikuusta.
IKA_ALUE = dict(lat_min=54.60, lat_max=55.30, lon_min=13.15, lon_max=13.65)
IKA_ENSIMMAINEN, IKA_REP_VIIMEINEN, IKA_MIN_PAIVAT = 2016, 2024, 25
# v59: lomaviikko. Piste: Kallanin eteläpuoli, merikartan 20 m:n käyrä, noin 5 km lähimmästä 1 m:n käyrästä [K Traficom-käyristä];
# asema: IL Pietarsaari Kallan (lähin tuuliasema pisteen 63,7515 N 22,5228 E ympäriltä).
LOMA_PISTE = dict(lat=63.740, lon=22.530)
LOMA_ASEMA = dict(nimi="Pietarsaari Kallan", lat=63.7515, lon=22.5228)
LOMA_JAKSO = ((5, 1), (7, 31))          # 1.5.–31.7. = 92 päivää
LOMA_PAIVA_H = (6, 20)                  # v59 (versio 1); v60 tallentaa kaikki tunnit
# v60: poikkileikkaus rannasta länteen. Rantapiste = lähin 1 m:n käyrän piste Kallanin itäpuolella [K Traficom-käyristä];
# suunta 270° [A: avomeri lännessä]; 2–12 km 1 km:n välein.
LOMA_RANTA = dict(lat=63.7387, lon=22.6261)
LOMA_KM = list(range(2, 13))
LOMA_VERSIO = 2


def loma_pisteet():
    km_aste = 111.32 * math.cos(math.radians(LOMA_RANTA["lat"]))
    return [{"km": k, "lat": LOMA_RANTA["lat"], "lon": round(LOMA_RANTA["lon"] - k / km_aste, 4)} for k in LOMA_KM]
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


def rakenna(phy, wav, sst, luotu, virheet, syvyys=None, tuuli=None, vaylat=None, alue=None, bgc=None, pohja=None, kerros=None,
            lisaantyminen=None):
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
    if lisaantyminen:   # v64
        hakemisto["lisaantyminen"] = lisaantyminen
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
                try:
                    return copernicusmarine.open_dataset(coordinates_selection_method="inside", **kw), ds_id
                except TypeError:
                    return copernicusmarine.open_dataset(**kw), ds_id
            except Exception as e1:  # noqa: BLE001
                if not lahde.get("muuttuja_vapaa"):
                    raise
                virheet.append(f"{ds_id} ({','.join(lahde['muuttujat'])}): {str(e1)[:200]}")
                kw.pop("variables", None)   # v65: muuttujan nimi voi olla uudessa datasetissä toinen
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



# ---------------------------------------------------------------- v57: ikäluokkaennusteen huhtikuun lämpö

def sst_kentta(ds):
    """v65: pintalämpömuuttuja: analysed_sst, muuten ensimmäinen, jonka nimessä sst, sitten temp/thetao."""
    try:
        return ds["analysed_sst"]
    except KeyError:
        pass
    nimet = list(getattr(ds, "data_vars", {}))
    for avain in ("sst", "temp", "thetao"):
        for n in nimet:
            if avain in n.lower() and "error" not in n.lower() and "mask" not in n.lower():
                print(f"  pintalämpö muuttujasta {n} (ei analysed_sst)")
                return ds[n]
    raise KeyError(f"ei pintalämpömuuttujaa: {nimet}")


REP_KORJAUS = "v66"   # muutos nollaa epäonnistuneiden vuosien päivämerkinnät kerran (uusi yritys heti; v65 REP-tunnus, v66 lomadatan 59 pv)
LOMA_TUULI_MIN = 59  # v66: kesän vähimmäistuulipäivät (≥ 12 tuntiarvoa); arvio [A], Hannu 22.11. (2022: 59 päivää)


def huhtikuun_lampo(lahde, vuosi):
    """Huhtikuun keskimääräinen pintalämpö (°C) laatikossa IKA_ALUE: päivittäinen alueen keskiarvo, sitten päivien keskiarvo."""
    alku = datetime(vuosi, 4, 1, tzinfo=timezone.utc)
    loppu = datetime(vuosi, 4, 30, 23, 59, tzinfo=timezone.utc)
    ds, ds_id = avaa(lahde, alku, loppu, alue=IKA_ALUE)
    a = np.asarray(sst_kentta(ds).values, dtype=float)
    a = a.reshape(a.shape[0], -1) if a.ndim >= 2 else a.reshape(-1, 1)
    if np.isfinite(a).any() and np.nanmean(a) > 200:   # kelvin -> °C
        a = a - 273.15
    with np.errstate(all="ignore"):
        paivat = np.nanmean(a, axis=1)
    ok = np.isfinite(paivat)
    return {"T": round(float(paivat[ok].mean()), 2) if ok.any() else None, "paivia": int(ok.sum()), "dataset": ds_id}


def hae_json_sivulta(osoite):
    try:
        with urllib.request.urlopen(osoite, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def kirjoita_json(polku, sis):
    os.makedirs(os.path.dirname(polku) or ".", exist_ok=True)
    with open(polku, "w", encoding="utf-8") as f:
        json.dump(sis, f, ensure_ascii=False, indent=1)


def viimeisin_huhtikuu(nyt):
    """Viimeisin kokonaan datassa oleva huhtikuu (NRT-viive ~1 vrk → 3.5. alkaen kuluva vuosi)."""
    return nyt.year if nyt >= datetime(nyt.year, 5, 3, tzinfo=timezone.utc) else nyt.year - 1


def paivita_ikaluokat(perus, nyt, osoite=None, hae=huhtikuun_lampo, vanha=None):
    """Kirjoittaa perus/ikaluokat.json. Vanhat vuodet säilyvät; puuttuvat haetaan (epäonnistunut vuosi yritetään
    uudelleen seuraavana päivänä, ei joka ajossa). Palauttaa tiedoston sisällön."""
    polku = os.path.join(perus, "ikaluokat.json")
    if vanha is None:
        osoite = (osoite or sivun_osoite()) + "ikaluokat.json"
        vanha = lue_vanha(polku) or hae_json_sivulta(osoite)
        if vanha is None:   # toinen yritys: katkos ei saa johtaa koko sarjan uudelleenhakuun ja vajaaseen tiedostoon
            time.sleep(5)
            vanha = hae_json_sivulta(osoite) or {}
    if vanha.get("huhtikuu"):
        kirjoita_json(polku, vanha)   # aikakatkaisunkin jälkeen julkaisuun menee vähintään edellinen
    tanaan = nyt.strftime("%Y-%m-%d")
    huhti = dict(vanha.get("huhtikuu") or {})
    yritetty = dict(vanha.get("yritetty") or {}) if vanha.get("korjaus") == REP_KORJAUS else {}   # v65: uusi REP-tunnus → heti uudelleen
    virheet = []
    for v in range(IKA_ENSIMMAINEN, viimeisin_huhtikuu(nyt) + 1):
        if str(v) in huhti or yritetty.get(str(v)) == tanaan:
            continue
        jarj = [("REP", "sst_rep"), ("NRT", "sst")] if v <= IKA_REP_VIIMEINEN else [("NRT", "sst"), ("REP", "sst_rep")]
        for nimi, avain in jarj:
            try:
                r = hae(LAHTEET[avain], v)
                if r["T"] is not None and r["paivia"] >= IKA_MIN_PAIVAT:
                    huhti[str(v)] = dict(r, lahde=nimi)
                    yritetty.pop(str(v), None)
                    print(f"  huhtikuu {v}: {r['T']} °C ({nimi}, {r['paivia']} pv)")
                    break
                virheet.append(f"{v} {nimi}: vain {r['paivia']} päivää")
            except Exception as e:  # noqa: BLE001
                virheet.append(f"{v} {nimi}: {str(e)[:200]}")
        if str(v) not in huhti:
            yritetty[str(v)] = tanaan
    # Lähteiden vertailu yhdeltä yhteiseltä vuodelta (kerran): NRT − REP samalle huhtikuulle.
    vert = vanha.get("vertailu")
    rep = huhti.get(str(IKA_REP_VIIMEINEN))
    if not vert and rep and rep.get("lahde") == "REP":
        try:
            r = hae(LAHTEET["sst"], IKA_REP_VIIMEINEN)
            vert = {"vuosi": IKA_REP_VIIMEINEN, "REP": rep["T"], "NRT": r["T"], "paivia": r["paivia"],
                    "erotus": round(r["T"] - rep["T"], 2) if r["T"] is not None else None}
        except Exception as e:  # noqa: BLE001
            vert = {"vuosi": IKA_REP_VIIMEINEN, "virhe": str(e)[:200]}
    tulos = {"versio": 1, "korjaus": REP_KORJAUS, "paivitetty": iso(nyt), "paikka": "Trelleborg–Sassnitz", "laatikko": IKA_ALUE,
             "huhtikuu": dict(sorted(huhti.items())), "vertailu": vert, "yritetty": yritetty, "virheet": virheet}
    if huhti:
        kirjoita_json(polku, tulos)
    else:
        print("  ikäluokat: ei yhtään huhtikuuta – tiedostoa ei kirjoiteta", file=sys.stderr)
    for v in virheet:
        print("  ikäluokat:", v, file=sys.stderr)
    return tulos



# ---------------------------------------------------------------- v59: lomaviikko (Kallan)

def loma_paivat(vuosi):
    a = datetime(vuosi, *LOMA_JAKSO[0], tzinfo=timezone.utc)
    b = datetime(vuosi, *LOMA_JAKSO[1], tzinfo=timezone.utc)
    return a, (b - a).days + 1


def loma_sst(lahde, vuosi):
    """v60: vuorokauden pintalämpö (°C × 10 tai None) poikkileikkauksen pisteissä 1.5.–31.7.: [[11 arvoa] × 92]."""
    a, n = loma_paivat(vuosi)
    pp = loma_pisteet()
    laatikko = dict(lat_min=LOMA_RANTA["lat"] - 0.02, lat_max=LOMA_RANTA["lat"] + 0.02,
                    lon_min=min(p["lon"] for p in pp) - 0.02, lon_max=max(p["lon"] for p in pp) + 0.02)
    ds, ds_id = avaa(lahde, a, a + timedelta(days=n) - timedelta(minutes=1), alue=laatikko)
    x = np.asarray(sst_kentta(ds).values, dtype=float)          # (aika, lat, lon)
    if np.isfinite(x).any() and np.nanmean(x) > 200:
        x = x - 273.15
    lat = np.asarray(ds["latitude"].values, dtype=float)
    lon = np.asarray(ds["longitude"].values, dtype=float)
    ajat = [paikallinen_pvm(t) for t in ds["time"].values] if "time" in ds else []
    out = [[None] * len(pp) for _ in range(n)]
    for k, p in enumerate(pp):
        mi = np.abs(lat - p["lat"]) <= 0.021          # ±1 solu (0,02°): maasolu (luoto) ei jätä pistettä tyhjäksi
        mj = np.abs(lon - p["lon"]) <= 0.021
        if not mi.any():
            mi = np.abs(lat - p["lat"]) == np.abs(lat - p["lat"]).min()
        if not mj.any():
            mj = np.abs(lon - p["lon"]) == np.abs(lon - p["lon"]).min()
        with np.errstate(all="ignore"):
            pv = np.nanmean(x[:, mi][:, :, mj].reshape(x.shape[0], -1), axis=1)
        for i, v in enumerate(pv):
            j = (datetime.fromisoformat(ajat[i]).replace(tzinfo=timezone.utc) - a).days if i < len(ajat) else i
            if 0 <= j < n and np.isfinite(v):
                out[j][k] = int(round(float(v) * 10))
    return out, ds_id


def loma_tuuli(vuosi, pyynto=None):
    """v60: Kallanin aseman tuntituulet (10 min keskituuli tasatunnilla, m/s × 10 tai None), Suomen ajan tunnit 0–23:
    [[24 arvoa] × 92]. 7 vrk:n kyselyt (IL:n raja 168 h)."""
    import hae_tuuli
    pyynto = pyynto or hae_tuuli._pyynto
    a, n = loma_paivat(vuosi)
    hki = ZoneInfo("Europe/Helsinki")
    out = [[None] * 24 for _ in range(n)]
    asema = None
    alku = a - timedelta(hours=3)                       # Suomen keskiyö kesäajassa = UTC −3 h
    loppu = a + timedelta(days=n) - timedelta(hours=3)
    t = alku
    while t < loppu:
        t2 = min(t + timedelta(hours=167), loppu)
        xml = pyynto({"service": "WFS", "version": "2.0.0", "request": "getFeature",
                      "storedquery_id": "fmi::observations::weather::simple", "parameters": "ws_10min", "timestep": "60",
                      "bbox": ",".join(f"{v:.3f}" for v in (LOMA_ASEMA["lon"] - 0.05, LOMA_ASEMA["lat"] - 0.03,
                                                          LOMA_ASEMA["lon"] + 0.05, LOMA_ASEMA["lat"] + 0.03)),
                      "starttime": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "endtime": t2.strftime("%Y-%m-%dT%H:%M:%SZ")})
        rivit = hae_tuuli.jasenna(xml)
        if rivit:   # lähin asema (bboxissa voi olla useampi)
            paikat = {(r[0], r[1]) for r in rivit}
            lahin = min(paikat, key=lambda p: (p[0] - LOMA_ASEMA["lat"]) ** 2 + ((p[1] - LOMA_ASEMA["lon"]) * 0.44) ** 2)
            asema = asema or {"lat": lahin[0], "lon": lahin[1]}
            for lat, lon, aika, param, arvo in rivit:
                if (lat, lon) != lahin or param.lower() != "ws_10min" or not np.isfinite(arvo):
                    continue
                tl = datetime.fromisoformat(aika.replace("Z", "+00:00")).astimezone(hki)
                if tl.minute != 0:
                    continue
                j = (datetime(tl.year, tl.month, tl.day, tzinfo=timezone.utc) - a).days
                if 0 <= j < n:
                    out[j][tl.hour] = int(round(arvo * 10))
        t = t2
    return out, asema


def paivita_lomadata(perus, nyt, osoite=None, hae_sst=loma_sst, hae_tuuli_fn=loma_tuuli, vanha=None, aikaraja_s=900):
    """data/lomadata.json: puuttuvat kokonaiset kesät (31.7. ohi) 2016 alkaen. Tiedosto kirjoitetaan kesä kerrallaan."""
    polku = os.path.join(perus, "lomadata.json")
    if vanha is None:
        osoite = (osoite or sivun_osoite()) + "lomadata.json"
        vanha = lue_vanha(polku) or hae_json_sivulta(osoite)
        if vanha is None:
            time.sleep(5)
            vanha = hae_json_sivulta(osoite) or {}
    if vanha.get("versio") != LOMA_VERSIO:   # v60: muoto muuttui → kaikki kesät uudelleen
        vanha = {}
    vuodet = dict(vanha.get("vuodet") or {})
    yritetty = dict(vanha.get("yritetty") or {}) if vanha.get("korjaus") == REP_KORJAUS else {}   # v65: uusi REP-tunnus → heti uudelleen
    tanaan, virheet, asema = nyt.strftime("%Y-%m-%d"), [], vanha.get("asema")
    viimeinen = nyt.year if nyt >= datetime(nyt.year, 8, 2, tzinfo=timezone.utc) else nyt.year - 1
    alku_t = time.monotonic()

    def kirjoita_nyt():
        if vuodet:
            kirjoita_json(polku, {"versio": LOMA_VERSIO, "korjaus": REP_KORJAUS, "paivitetty": iso(nyt), "piste": LOMA_PISTE, "asema": asema,
                                  "asemaNimi": LOMA_ASEMA["nimi"], "jakso": ["05-01", "07-31"], "ranta": LOMA_RANTA,
                                  "suunta": 270, "pisteet": loma_pisteet(), "vuodet": dict(sorted(vuodet.items())),
                                  "yritetty": yritetty, "virheet": virheet})
    if vuodet:
        kirjoita_nyt()
    for v in range(IKA_ENSIMMAINEN, viimeinen + 1):
        if str(v) in vuodet or yritetty.get(str(v)) == tanaan:
            continue
        if time.monotonic() - alku_t > aikaraja_s:
            virheet.append(f"{v}: aikaraja, jatketaan seuraavassa ajossa")
            break
        rivi = {}
        jarj = [("REP", "sst_rep"), ("NRT", "sst")] if v <= IKA_REP_VIIMEINEN else [("NRT", "sst"), ("REP", "sst_rep")]
        for nimi, avain in jarj:
            try:
                sst, ds_id = hae_sst(LAHTEET[avain], v)
                paivia = sum(1 for d in sst if any(x is not None for x in d))
                if paivia >= 80:
                    rivi.update(sst=sst, sstLahde=nimi)
                    break
                virheet.append(f"{v} SST {nimi}: vain {paivia} päivää")
            except Exception as e:  # noqa: BLE001
                virheet.append(f"{v} SST {nimi}: {str(e)[:160]}")
        try:
            tuuli, a = hae_tuuli_fn(v)
            paivia = sum(1 for d in tuuli if sum(x is not None for x in d) >= 12)
            if paivia >= LOMA_TUULI_MIN:
                rivi["tuuli"] = tuuli
                asema = asema or a
            else:
                virheet.append(f"{v} tuuli: vain {paivia} päivää")
        except Exception as e:  # noqa: BLE001
            virheet.append(f"{v} tuuli: {str(e)[:160]}")
        if "sst" in rivi and "tuuli" in rivi:
            vuodet[str(v)] = rivi
            yritetty.pop(str(v), None)
            print(f"  lomadata {v}: SST {rivi['sstLahde']}, tuulipäiviä {sum(1 for d in rivi['tuuli'] if sum(x is not None for x in d) >= 12)}")
            kirjoita_nyt()
        else:
            yritetty[str(v)] = tanaan
    kirjoita_nyt()
    for x in virheet:
        print("  lomadata:", x, file=sys.stderr)
    return {"vuodet": vuodet, "yritetty": yritetty, "virheet": virheet, "asema": asema}


VAROITUS_URL = "https://alerts.fmi.fi/cap/feed/atom_fi-FI.xml"


def paivita_varoitukset(perus, hae=None):
    """v62: IL:n voimassa olevat varoitukset (0–5 vrk) sellaisenaan tiedostoon varoitukset.xml (sovellus jäsentää)."""
    def lataa(url):
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "merilohitutka (github.com/Lohirosvo/merilohitutka)"}), timeout=30) as r:
            return r.read()
    data = (hae or lataa)(VAROITUS_URL)
    if b"<feed" not in data[:3000]:
        raise ValueError("vastaus ei ole Atom-syöte: " + data[:120].decode("utf-8", "replace"))
    os.makedirs(perus or ".", exist_ok=True)
    with open(os.path.join(perus, "varoitukset.xml"), "wb") as f:
        f.write(data)
    print(f"  varoitukset: {data.count(b'<entry')} kpl, {len(data) // 1024} kt")
    return data.count(b"<entry")


JOKILASKURI_URL = "https://www.lansstyrelsen.se/norrbotten/djur/fiske/fiskeutredning/fiskrakning.html"
# [L lansstyrelsen.se]: Jockfall noin 100 km Kalixälvenin suulta ylävirtaan; Linaälven on Kalixälvenin sivujoki.
JOKILASKURIT = {"jockfall": {"nimi": "Jockfall", "joki": "Kalixälven", "km": 100},
                "linafallet": {"nimi": "Linafallet", "joki": "Linaälven", "km": None}}


def _avain(nimi):
    return "".join(c for c in nimi.lower().replace("ä", "a").replace("å", "a").replace("ö", "o") if c.isalnum())


def jasenna_fiskrakning(html):
    """HTML → {avain: {"vuosi", "paivat": {pvm: lax}, "yhteensa", "asennettu"}}. Taulukon tunnistus edeltävästä
    otsikosta "De tio senaste dagarnas fiskräkning i <joki>, <paikka>, <vuosi>"; sarakkeet otsikkoriviltä (Datum, Lax)."""
    import re
    from html.parser import HTMLParser

    class P(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.taulut, self.teksti, self.syvyys, self.rivi, self.solu = [], [], 0, None, None

        def handle_starttag(self, tag, attrs):
            if tag == "table":
                self.syvyys += 1
                if self.syvyys == 1:
                    self.taulut.append({"ennen": " ".join(self.teksti)[-400:], "rivit": []})
                    self.teksti = []
            elif self.syvyys and tag == "tr":
                self.rivi = []
            elif self.syvyys and tag in ("td", "th"):
                self.solu = []

        def handle_endtag(self, tag):
            if tag == "table" and self.syvyys:
                self.syvyys -= 1
            elif self.syvyys and tag in ("td", "th") and self.solu is not None and self.rivi is not None:
                self.rivi.append(" ".join("".join(self.solu).split()))
                self.solu = None
            elif self.syvyys and tag == "tr" and self.rivi is not None:
                if self.rivi:
                    self.taulut[-1]["rivit"].append(self.rivi)
                self.rivi = None

        def handle_data(self, data):
            if self.syvyys and self.solu is not None:
                self.solu.append(data)
            elif self.syvyys and data.strip():
                self.taulut[-1]["ennen"] += " " + " ".join(data.split())   # caption tms. taulukon sisällä
            elif not self.syvyys and data.strip():
                self.teksti.append(" ".join(data.split()))

    p = P()
    p.feed(html)
    luku = lambda x: int(re.sub(r"[^\d]", "", x)) if re.search(r"\d", x or "") else 0
    tulos = {}
    for t in p.taulut:
        sisalto = " ".join(" ".join(r) for r in t["rivit"][:2])
        # v65: otsikko väljemmin (ä voi olla mitä tahansa merkistövirheen takia); laskuri myös pelkästä paikan nimestä
        m = re.search(r"fiskr.{1,2}kning i ([^,]+),\s*([^,]+?),\s*(\d{4})", t["ennen"]) or \
            re.search(r"fiskr.{1,2}kning i ([^,]+),\s*([^,]+?)\s*,?\s*(\d{4})", sisalto)
        otsake = next((r for r in t["rivit"] if any(c.lower().startswith("datum") for c in r)), None)
        if not otsake or not any(c.lower().startswith("lax") for c in otsake):
            continue
        if m:
            avain = _avain(m.group(2))
        else:
            loydetyt = [(t["ennen"] + " " + sisalto).lower().rfind(k) for k in ("jockfall", "linafallet")]
            if max(loydetyt) < 0:
                continue
            avain = ("jockfall", "linafallet")[loydetyt.index(max(loydetyt))]   # lähimpänä taulukkoa oleva nimi
        i_lax = [c.lower()[:3] for c in otsake].index("lax")
        paivat, yhteensa, asennettu, lajit, v_total = {}, None, None, {}, None
        for r in t["rivit"]:
            eka = r[0] if r else ""
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", eka):
                paivat[eka] = luku(r[i_lax]) if len(r) > i_lax else 0
            elif eka.upper().startswith("TOTAL") and len(r) > i_lax:
                yhteensa = luku(r[i_lax])
                # v65: kauden päätyttyä sivulla vain "TOTAL 2026" -rivi (Jockfall) / "TOTALT 2026" (Linafallet)
                lajit = {otsake[i].lower(): luku(r[i]) for i in range(1, min(len(r), len(otsake))) if re.search(r"\d", r[i])}
                vt = re.search(r"(20\d{2})", eka)
                v_total = int(vt.group(1)) if vt else None
        a = re.search(r"[Ii]nstaller\w*\D{0,20}(\d{4}-\d{2}-\d{2})", t["ennen"] + " " + " ".join(" ".join(r) for r in t["rivit"]))
        if a:
            asennettu = a.group(1)
        vuodet = [int(k[:4]) for k in paivat]
        vuosi = int(m.group(3)) if m else (max(set(vuodet), key=vuodet.count) if vuodet else v_total)
        if vuosi is None:
            continue
        perus = JOKILASKURIT.get(avain, {})
        tulos[avain] = {"vuosi": vuosi, "paivat": paivat, "yhteensa": yhteensa, "asennettu": asennettu, "lajit": lajit,
                        "paattynyt": bool(re.search(r"avslutad", t["ennen"], re.I)),
                        "joki": m.group(1).strip() if m else perus.get("joki", ""), "paikka": m.group(2).strip() if m else perus.get("nimi", avain)}
    return tulos


def jokisivun_tila(html):
    """v65: { paattynyt, ote }: päättynyt = sivulla "avslutad" (Hannu 22.11.: "Fiskräkning Jockfall, Kalixälven är nu
    avslutad"); ote = raaka HTML Jockfall-kohdan ympäriltä tunnistuksen korjaamiseksi."""
    import re
    teksti = re.sub(r"<[^>]+>", " ", html)
    paattynyt = bool(re.search(r"avslutad", teksti, re.I))
    i = html.lower().find("jockfall")
    ote = html[max(0, i - 1500): i + 3000] if i >= 0 else html[:3000]
    return {"paattynyt": paattynyt, "taulukoita": html.lower().count("<table"), "pituus": len(html), "ote": ote}


def paivita_jokilaskurit(perus, nyt, hae=None, vanha=None):
    """Kirjoittaa perus/jokilaskurit.json: aiemmat päivät säilyvät, sivulta luetut lisätään (sama päivä: uusi arvo)."""
    polku = os.path.join(perus, "jokilaskurit.json")
    if vanha is None:
        vanha = lue_vanha(polku) or hae_json_sivulta(sivun_osoite() + "jokilaskurit.json") or {}
    sis = {"versio": 1, "lahde": "Länsstyrelsen Norrbotten, fiskräkning (De tio senaste dagarnas fiskräkning)",
           "url": JOKILASKURI_URL, "laskurit": dict(vanha.get("laskurit") or {}), "luotu": vanha.get("luotu")}
    if sis["laskurit"]:
        kirjoita_json(polku, sis)   # haun virhe ei hävitä kerättyjä päiviä

    def lataa(url):
        pyynto = urllib.request.Request(url, headers={"User-Agent": "merilohitutka (github.com/Lohirosvo/merilohitutka)"})
        with urllib.request.urlopen(pyynto, timeout=30) as r:
            return r.read().decode(r.headers.get_content_charset() or "utf-8", "replace")   # v65: merkistö otsakkeesta
    html = (hae or lataa)(JOKILASKURI_URL)
    taulut = jasenna_fiskrakning(html)
    if not taulut:
        tila = jokisivun_tila(html)
        sis["luotu"] = nyt.strftime("%Y-%m-%dT%H:%MZ")
        if tila["paattynyt"]:   # v65: kausi ohi → ei virhe; kerätyt päivät säilyvät
            sis["tila"] = {"tulos": "päättynyt", "haettu": sis["luotu"]}
            kirjoita_json(polku, sis)
            print("  jokilaskurit: laskenta päättynyt tältä vuodelta (sivulla 'avslutad'), ei taulukkoa")
            return sis
        sis["tila"] = {"tulos": "virhe", "haettu": sis["luotu"], "taulukoita": tila["taulukoita"], "pituus": tila["pituus"],
                       "ote": tila["ote"]}
        kirjoita_json(polku, sis)   # ote julkiseen tiedostoon: tunnistus korjataan sen perusteella
        raise ValueError(f"sivulta ei löytynyt laskuritaulukoita ({tila['taulukoita']} <table>, {tila['pituus']} merkkiä; ote jokilaskurit.json:ssa)")
    for avain, t in taulut.items():
        k = sis["laskurit"].setdefault(avain, dict(JOKILASKURIT.get(avain, {"nimi": t["paikka"], "joki": t["joki"], "km": None}), vuodet={}))
        if t["yhteensa"] is not None:   # v65: kauden kokonaismäärä erikseen (päättyneen kauden sivulla vain TOTAL-rivi)
            k.setdefault("kaudet", {})[str(t["vuosi"])] = {"yhteensa": t["yhteensa"], "lajit": t.get("lajit") or {},
                                                          "paattynyt": bool(t.get("paattynyt")), "haettu": nyt.strftime("%Y-%m-%dT%H:%MZ")}
        if not t["paivat"] and str(t["vuosi"]) not in k["vuodet"]:
            print(f"  jokilaskuri {avain} {t['vuosi']}: ei päiviä sivulla, kauden kokonaismäärä {t['yhteensa']}"
                  + (" (laskenta päättynyt)" if t.get("paattynyt") else ""))
            continue   # vuosi ilman päiviä ei vuodet-kohtaan (sovellus piirtää sieltä päiväkuvaajan)
        v = k["vuodet"].setdefault(str(t["vuosi"]), {"paivat": {}})
        v["paivat"] = dict(sorted({**v.get("paivat", {}), **t["paivat"]}.items()))
        if t["yhteensa"] is not None:
            v["yhteensa"] = t["yhteensa"]
        if t["asennettu"]:
            v["asennettu"] = t["asennettu"]
        v["haettu"] = nyt.strftime("%Y-%m-%dT%H:%MZ")
        print(f"  jokilaskuri {avain} {t['vuosi']}: {len(t['paivat'])} päivää sivulla, talteen {len(v['paivat'])}, yhteensä {t['yhteensa']}")
    sis["luotu"] = nyt.strftime("%Y-%m-%dT%H:%MZ")
    sis["tila"] = {"tulos": "päättynyt" if any(t.get("paattynyt") for t in taulut.values()) else "ok", "haettu": sis["luotu"]}
    kirjoita_json(polku, sis)
    return sis


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
    syvyys = vaylat = tuuli = lisa = None
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
    try:  # v64: VELMU-poikastuotantoalueet (aineisto 2019, haetaan kerran vuodessa)
        import hae_lisaantyminen
        alku = time.monotonic()
        lisa = hae_lisaantyminen.paivita(kansio, osoite, alue=rajat)
        print(f"lisääntymisalueet: {lisa.get('tila')}, {time.monotonic() - alku:.0f} s")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        lisa = {"tila": "virhe", "viesti": f"{e}"[:300]}
    rajat_tila = None
    if alue.get("lohirajat"):   # v67: lohen 4 mpk:n raja Traficomin perusviivasta (harvoin, 90 vrk); ei Ahvenanmaalle (Hannu 22.11.)
        try:
            import hae_rajat
            alku = time.monotonic()
            rajat_tila = hae_rajat.paivita(kansio, osoite, alue=rajat, kuvaus=alue)
            print(f"lohirajat: {rajat_tila.get('tila')}, {time.monotonic() - alku:.0f} s")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            rajat_tila = {"tila": "virhe", "viesti": f"{e}"[:300]}
    vesi_tila = None
    if alue.get("lohirajat"):   # v71: valtion yleinen vesialue (MML, avain MML_API_KEY); ei Ahvenanmaalle (kuten lohirajat)
        try:
            import hae_vesialueet
            alku = time.monotonic()
            vesi_tila = hae_vesialueet.paivita(kansio, osoite, alue=rajat)
            print(f"vesialueet: {vesi_tila.get('tila')}, {time.monotonic() - alku:.0f} s")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            vesi_tila = {"tila": "virhe", "viesti": f"{e}"[:300]}
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
                                   bgc=bgc, pohja=pohja, kerros=kerros, lisaantyminen=lisa)
    if alue.get("silakka") and vanha_pohja and "pohja" not in hakemisto:
        hakemisto["pohja"] = vanha_pohja
    if rajat_tila:   # v67
        hakemisto["rajat"] = rajat_tila
    if vesi_tila:   # v71
        hakemisto["vesialueet"] = vesi_tila
    hakemisto["tunnus"], hakemisto["nimi"] = tunnus, alue.get("nimi", tunnus)
    kirjoita(kansio, hakemisto, tiedostot)
    return True


def main(polku):
    perus = os.path.dirname(polku) or "."
    nyt = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    luotu = iso(datetime.now(timezone.utc))  # todellinen hakuhetki (näytetään käyttäjälle)
    onnistui = []
    try:   # v62: IL:n varoitukset (pieni, joka ajossa)
        paivita_varoitukset(perus)
    except Exception as e:  # noqa: BLE001
        print(f"Varoitukset: VIRHE {e}", file=sys.stderr)
    try:   # v63: jokilaskurit (pieni sivu, joka ajossa)
        paivita_jokilaskurit(perus, nyt)
    except Exception as e:  # noqa: BLE001
        print(f"Jokilaskurit: VIRHE {e}", file=sys.stderr)
    try:   # v57: ensin (pieni haku, kerran vuodessa); virhe ei estä alueita
        paivita_ikaluokat(perus, nyt)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        print(f"Ikäluokat: VIRHE {e}", file=sys.stderr)
    alueet = lue_alueet()
    for alue in alueet:
        alku = time.monotonic()
        try:
            ok = hae_alue(alue, perus, nyt, luotu)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            print(f"Alue {alue.get('tunnus')}: VIRHE {e}", file=sys.stderr)
            ok = False
        onnistui.append(ok)
        print(f"===== Alue {alue.get('tunnus')}: {'OK' if ok else 'VIRHE'}, {time.monotonic() - alku:.0f} s")
    try:   # v59: alueiden jälkeen (ensimmäinen ajo ~11 kesää); virhe ei vaikuta muuhun
        paivita_lomadata(perus, nyt)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        print(f"Lomadata: VIRHE {e}", file=sys.stderr)
    # v71: v68:n vesialuekoe (koe_vesialueet.py) poistettu ajosta – tulos selvä, varsinainen haku hae_vesialueet.py:ssä.
    if not all(onnistui):
        sys.exit(1)   # lokiin punainen merkki; julkaisu tehdään silti (continue-on-error)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "meri.json")
