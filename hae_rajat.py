"""Merilohitutka – hae_rajat.py (v67, 22.11.2026)

Hannu 22.11.2026: "Saako kartalle sen lohen kalastusviivan missä raja kulkee. Olisi tärkeä." → "Tehdään, ei viivaa
ahvenanmaalle". Lohen vapaa-ajankalastuksen säännöt eroavat 4 meripeninkulman rajan sisä- ja ulkopuolella: [L SVK 2026]
"Alue ulottuu rannikosta 4 meripeninkulmaa (7,41 km) perusviivan ulkopuolelle"; SVK:n oma kartta on kuvitus ("kartan rajat
eivät ole tarkkoja"). Valmista 4 mpk:n viivaa ei löytynyt avoimena datana → viiva lasketaan perusviivasta.

Lähde [L INSPIRE-metatieto]: Traficomin avoimessa WMS:ssä taso "Sisäisten aluevesien ulkoraja (StraightTerritorialSeaBaseline_L)",
aineisto "Aluevesien rajat" (CC BY 4.0). Että sama taso on WFS:ssä viivoina = [A] → GetCapabilities kertoo (lokiin tasojen
nimet). Että tämä viiva on lohisäännön "perusviiva" = [A, nimi "straight territorial sea baseline"].

Laskenta [K], alueen ympäriltä 100 m:n ruudukossa (lat/lon, ~100 × 100 m):
 1. Perusviiva haetaan 20 km:n reunuksella ja rasteroidaan esteeksi.
 2. Merenpuoli: ruudukon yhtenäiset osat (4-naapuruus, este katkaisee). Maan puoli = osat, joissa on alueen tunnettu maapiste
    (luiskat, satamat) tai jotka eivät kosketa ruudukon reunaa (saariryhmän oma perusviivasilmukka); muut = merenpuoli.
 3. Tarkistus: perusviivan janoista vähintään 80 %:n pitää erottaa maan- ja merenpuoli (300 m kummallekin puolelle).
    Muuten aukko perusviivassa tai väärä maapiste → virhe, ei viivaa (väärä viiva olisi pahempi kuin ei viivaa).
 4. Etäisyys perusviivaan ETRS-TM35FIN-metreinä, jaettuna projektion mittakaavalla (alueilla 1,0004–1,0011).
 5. 4 mpk:n raja = merenpuolen 7408 m:n käyrä (marching squares), pisteet tarkennetaan tarkalle etäisyydelle (kulmissa viiva
    jää raja-alueen sisäpuolelle, ei ulos), yksinkertaistus 5 m.
 6. Sisä/ulko-ruudukko (rivit pituussuunnassa ajonpituuskoodattuna) puhelimen napautukseen ja myöhemmin Kala kiinni -kiintiöön.
Tarkkuus [K, testi Vincentyn geodeettisella etäisyydellä]: viiva ±1 m + yksinkertaistus 5 m; luokkaruudukko ±70 m (solu);
perusviivan oma tarkkuus tuntematon [A].
Ei virallinen raja. Ei navigointikäyttöön.
"""
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

import numpy as np

import hae_syvyys as HS

WFS = ["https://julkinen.traficom.fi/inspirepalvelu/avoin/wfs",
       "https://julkinen.traficom.fi/inspirepalvelu/rajoitettu/wfs"]
TASON_AVAIMET = ["straightterritorialseabaseline", "territorialseabaseline", "baseline", "perusviiva",
                 "sisaisten_aluevesien", "sisäisten aluevesien"]
MPK_M = 4 * 1852.0          # 4 meripeninkulmaa = 7408 m [K]
HAKU_REUNA_KM = 20.0        # perusviiva haetaan alueen ympäriltä
RUUTU_REUNA_KM = 10.0       # laskentaruudukko alueen ympäriltä (≤ HAKU − 7,4 km, jotta kaikki lähellä oleva perusviiva on mukana)
SOLU_M = 100.0
TARKISTUS_M = 300.0
EROTTAA_MIN = 0.8
TOLERANSSI_M = 5.0
VERSIO = 1
UUSINTA_VRK = 90
LAHDE = "Liikenne- ja viestintävirasto Traficom, Aluevesien rajat: sisäisten aluevesien ulkoraja (perusviiva), CC BY 4.0"
HUOM = ("4 mpk:n raja laskettu perusviivasta (4 × 1852 m merelle päin), ei virallinen raja. "
        "Ei navigointikäyttöön.")
OTSAKE = {"User-Agent": "merilohitutka/67 (github.com/Lohirosvo/merilohitutka; harvoin)"}
_R = 6381000.0              # Maan säde mittakaavakertoimeen (leveys ~62°), m


# ---------------------------------------------------------------- projektio (numpy)
def tm35_np(lat, lon):
    """Vektoroitu hae_syvyys.tm35: (lat, lon) asteina -> (E, N) metreinä."""
    fi, la = np.radians(lat), np.radians(lon)
    q = np.arcsinh(np.tan(fi)) - HS._E * np.arctanh(HS._E * np.sin(fi))
    beta = np.arctan(np.sinh(q))
    eta0 = np.arctanh(np.cos(beta) * np.sin(la - HS._LON0))
    xi0 = np.arcsin(np.sin(beta) * np.cosh(eta0))
    xi, eta = xi0.copy(), eta0.copy()
    for i, h in enumerate(HS._H, 1):
        xi = xi + h * np.sin(2 * i * xi0) * np.cosh(2 * i * eta0)
        eta = eta + h * np.cos(2 * i * xi0) * np.sinh(2 * i * eta0)
    return HS._A1 * eta * HS._K0 + HS._E0, HS._A1 * xi * HS._K0


def mittakaava(e):
    """TM-projektion pistemittakaava itäkoordinaatista (k0 = 0,9996, keskimeridiaani 27° E)."""
    x = (np.asarray(e, dtype=float) - HS._E0) / HS._K0
    return HS._K0 * (1 + x * x / (2 * _R * _R) + x ** 4 / (24 * _R ** 4))


# ---------------------------------------------------------------- ruudukko
def ruudukko(alue):
    """Laskentaruudukko alueen ympärille: dict(lat0, lon0, dlat, dlon, ny, nx) (solujen alakulma, koko asteina)."""
    lat_mid = (alue["lat_min"] + alue["lat_max"]) / 2
    dlat = round(SOLU_M / 110574.0, 6)
    dlon = round(SOLU_M / (111320.0 * math.cos(math.radians(lat_mid))), 6)
    rl, ro = RUUTU_REUNA_KM * 1000 / 110574.0, RUUTU_REUNA_KM * 1000 / (111320.0 * math.cos(math.radians(alue["lat_max"])))
    lat0, lon0 = alue["lat_min"] - rl, alue["lon_min"] - ro
    ny = int(math.ceil((alue["lat_max"] + rl - lat0) / dlat))
    nx = int(math.ceil((alue["lon_max"] + ro - lon0) / dlon))
    return {"lat0": round(lat0, 6), "lon0": round(lon0, 6), "dlat": dlat, "dlon": dlon, "ny": ny, "nx": nx}


def solu(G, lat, lon):
    return int(math.floor((lat - G["lat0"]) / G["dlat"])), int(math.floor((lon - G["lon0"]) / G["dlon"]))


def tihenna(v, askel_m=500.0):
    """Murtoviivan janat ovat suoria ETRS-TM35FIN-tasossa (aineiston oma koordinaatisto [A]); lisäpisteet ≤ askel_m välein, jotta
    rasterointi ja kartan piirto (lat/lon-suorat) seuraavat samaa viivaa. Pitkällä janalla ero olisi kymmeniä metrejä [K]."""
    out = [v[0]]
    for (a0, b0), (a1, b1) in zip(v[:-1], v[1:]):
        (e0, n0), (e1, n1) = HS.tm35(a0, b0), HS.tm35(a1, b1)
        n = max(1, int(math.ceil(math.hypot(e1 - e0, n1 - n0) / askel_m)))
        out += [HS.tm35_latlon(e0 + (e1 - e0) * k / n, n0 + (n1 - n0) * k / n) for k in range(1, n)] + [(a1, b1)]
    return out


def rasteroi(G, viivat):
    """Perusviiva esteeksi: näytteet janoilta ≤ puolen solun välein → 8-naapuruudessa yhtenäinen ketju (4-täyttö ei pääse läpi)."""
    este = np.zeros((G["ny"], G["nx"]), dtype=bool)
    for v in viivat:
        for (a0, b0), (a1, b1) in zip(v[:-1], v[1:]):
            n = int(math.ceil(max(abs(a1 - a0) / (G["dlat"] / 2), abs(b1 - b0) / (G["dlon"] / 2)))) + 1
            t = np.linspace(0.0, 1.0, n + 1)
            i = np.floor((a0 + (a1 - a0) * t - G["lat0"]) / G["dlat"]).astype(int)
            j = np.floor((b0 + (b1 - b0) * t - G["lon0"]) / G["dlon"]).astype(int)
            ok = (i >= 0) & (i < G["ny"]) & (j >= 0) & (j < G["nx"])
            este[i[ok], j[ok]] = True
    return este


def osat(este):
    """Yhtenäiset osat (4-naapuruus), este = -1. Palauttaa (nimiö ny×nx int32, osien määrä)."""
    ny, nx = este.shape
    lab = [0] * (ny * nx)
    for p in np.flatnonzero(este.ravel()).tolist():
        lab[p] = -1
    k = 0
    for alku in range(ny * nx):
        if lab[alku] != 0:
            continue
        k += 1
        lab[alku] = k
        pino = [alku]
        while pino:
            p = pino.pop()
            c = p % nx
            if c > 0 and lab[p - 1] == 0:
                lab[p - 1] = k; pino.append(p - 1)
            if c < nx - 1 and lab[p + 1] == 0:
                lab[p + 1] = k; pino.append(p + 1)
            if p >= nx and lab[p - nx] == 0:
                lab[p - nx] = k; pino.append(p - nx)
            q = p + nx
            if q < ny * nx and lab[q] == 0:
                lab[q] = k; pino.append(q)
    return np.array(lab, dtype=np.int32).reshape(ny, nx), k


def maapisteet(alue_kuvaus):
    """Varmasti maan puolella olevat pisteet: luiskat, sisäosuuden satama (jatko), satamamerkit (neliö) ja lohirajat.maa."""
    a, out = alue_kuvaus or {}, []
    for p in a.get("lahtopisteet") or []:
        if p.get("tyyppi") == "luiska":
            out.append((p["lat"], p["lon"]))
        if p.get("jatko"):
            out.append((p["jatko"]["lat"], p["jatko"]["lon"]))
    for m in a.get("merkit") or []:
        if m.get("muoto") == "nelio":
            out.append((m["lat"], m["lon"]))
    lr = a.get("lohirajat")
    if isinstance(lr, dict):
        out += [tuple(x) for x in lr.get("maa") or []]
    return out


def _metri_offset(lat, lon, dx, dy):
    return lat + dy / 110574.0, lon + dx / (111320.0 * math.cos(math.radians(lat)))


def luokittele(G, viivat, maa):
    """Maan puoli / merenpuoli. Palauttaa (meri bool, este bool, tilasto) tai nostaa ValueErrorin."""
    este = rasteroi(G, viivat)
    if not este.any():
        raise ValueError("perusviiva ei kulje laskentaruudukon kautta")
    lab, n = osat(este)
    reuna = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist()) - {-1}
    siemen = set()
    for la, lo in maa:
        i, j = solu(G, la, lo)
        for di, dj in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            ii, jj = i + di, j + dj
            if 0 <= ii < G["ny"] and 0 <= jj < G["nx"] and lab[ii, jj] > 0:
                siemen.add(int(lab[ii, jj]))
                break
    if not siemen:
        raise ValueError("yksikään alueen maapiste (luiska, satama) ei ole laskentaruudukossa")
    meren_osat = np.array(sorted(reuna - siemen), dtype=np.int32)
    meri = np.isin(lab, meren_osat)
    if not meri.any():
        raise ValueError("merenpuolta ei jäänyt: perusviivassa on aukko tai maapiste on perusviivan ulkopuolella")
    # Tarkistus: janan kummallakin puolella eri luokka (maa / meri)
    erottaa = arvioitu = 0
    for v in viivat:
        for (a0, b0), (a1, b1) in zip(v[:-1], v[1:]):
            la, lo = (a0 + a1) / 2, (b0 + b1) / 2
            dx, dy = (b1 - b0) * 111320.0 * math.cos(math.radians(la)), (a1 - a0) * 110574.0
            L = math.hypot(dx, dy)
            if L < 2 * SOLU_M:
                continue
            nx_, ny_ = -dy / L, dx / L
            puolet = []
            for s in (1, -1):
                pla, plo = _metri_offset(la, lo, s * nx_ * TARKISTUS_M, s * ny_ * TARKISTUS_M)
                i, j = solu(G, pla, plo)
                if not (0 <= i < G["ny"] and 0 <= j < G["nx"]) or este[i, j]:
                    break
                puolet.append(bool(meri[i, j]))
            if len(puolet) == 2:
                arvioitu += 1
                erottaa += puolet[0] != puolet[1]
    osuus = erottaa / arvioitu if arvioitu else 0.0
    tilasto = {"osia": int(n), "reunan_osia": len(reuna), "maan_osia": int(n - len(meren_osat)),
               "meri_osuus": round(float(meri.mean()), 3), "janoja_arvioitu": arvioitu, "janoja_erottaa": erottaa,
               "erottaa_osuus": round(osuus, 3)}
    if arvioitu and osuus < EROTTAA_MIN:
        raise ValueError(f"perusviiva erottaa maan ja meren vain {erottaa}/{arvioitu} janalla – aukko tai väärä maapiste")
    return meri, este, tilasto


def etaisyys(G, viivat):
    """Etäisyys perusviivaan (todellisina metreinä, TM35FIN / mittakaava); kauempana kuin 4 mpk + 1 km = inf."""
    lat = G["lat0"] + (np.arange(G["ny"]) + 0.5) * G["dlat"]
    lon = G["lon0"] + (np.arange(G["nx"]) + 0.5) * G["dlon"]
    LA, LO = np.meshgrid(lat, lon, indexing="ij")
    E, N = tm35_np(LA, LO)
    k = mittakaava(E)
    d = np.full(E.shape, np.inf)
    vara = MPK_M + 1000.0
    for v in viivat:
        P = [HS.tm35(a, b) for a, b in v]
        for (la0, lo0), (la1, lo1), (e0, n0), (e1, n1) in zip(v[:-1], v[1:], P[:-1], P[1:]):
            i0 = max(0, int((min(la0, la1) - vara / 110574.0 - G["lat0"]) / G["dlat"]))
            i1 = min(G["ny"], int((max(la0, la1) + vara / 110574.0 - G["lat0"]) / G["dlat"]) + 2)
            kx = 111320.0 * math.cos(math.radians(max(abs(la0), abs(la1)) + 0.2))
            j0 = max(0, int((min(lo0, lo1) - vara / kx - G["lon0"]) / G["dlon"]))
            j1 = min(G["nx"], int((max(lo0, lo1) + vara / kx - G["lon0"]) / G["dlon"]) + 2)
            if i0 >= i1 or j0 >= j1:
                continue
            e, n = E[i0:i1, j0:j1], N[i0:i1, j0:j1]
            dx, dy = e1 - e0, n1 - n0
            L2 = dx * dx + dy * dy
            t = np.clip(((e - e0) * dx + (n - n0) * dy) / L2, 0, 1) if L2 > 0 else 0.0
            dd = np.hypot(e - (e0 + t * dx), n - (n0 + t * dy)) / k[i0:i1, j0:j1]
            np.minimum(d[i0:i1, j0:j1], dd, out=d[i0:i1, j0:j1])
    return d


# ---------------------------------------------------------------- käyrä (marching squares)
def kayra0(G, f):
    """f:n nollakäyrä solukeskusten ruudukossa → murtoviivat [[(lat, lon), ...], ...]."""
    ny, nx = f.shape
    s = f >= 0
    koodi = (s[:-1, :-1] * 1 + s[:-1, 1:] * 2 + s[1:, 1:] * 4 + s[1:, :-1] * 8)
    ehd = np.argwhere((koodi > 0) & (koodi < 15))

    def kp(i, j):
        return G["lat0"] + (i + 0.5) * G["dlat"], G["lon0"] + (j + 0.5) * G["dlon"]

    pisteet = {}

    def reuna(tyyppi, i, j):
        avain = (tyyppi, i, j)
        if avain not in pisteet:
            (i0, j0), (i1, j1) = ((i, j), (i, j + 1)) if tyyppi == "h" else ((i, j), (i + 1, j))
            f0, f1 = f[i0, j0], f[i1, j1]
            t = f0 / (f0 - f1) if f0 != f1 else 0.5
            (a0, b0), (a1, b1) = kp(i0, j0), kp(i1, j1)
            pisteet[avain] = (a0 + t * (a1 - a0), b0 + t * (b1 - b0))
        return avain

    naapurit = {}

    def liita(p, q):
        naapurit.setdefault(p, []).append(q)
        naapurit.setdefault(q, []).append(p)

    for i, j in ehd.tolist():
        c = int(koodi[i, j])
        # reunat: 0 ala (a–b), 1 oikea (b–c), 2 ylä (d–c), 3 vasen (a–d); a = (i,j), b = (i,j+1), c = (i+1,j+1), d = (i+1,j)
        R = {0: lambda: reuna("h", i, j), 1: lambda: reuna("v", i, j + 1), 2: lambda: reuna("h", i + 1, j), 3: lambda: reuna("v", i, j)}
        a, b, cc, d = s[i, j], s[i, j + 1], s[i + 1, j + 1], s[i + 1, j]
        ristissa = [e for e, (x, y) in enumerate(((a, b), (b, cc), (d, cc), (a, d))) if x != y]
        if len(ristissa) == 2:
            liita(R[ristissa[0]](), R[ristissa[1]]())
        elif len(ristissa) == 4:
            keski = (f[i, j] + f[i, j + 1] + f[i + 1, j + 1] + f[i + 1, j]) / 4 >= 0
            if (c == 5) == keski:   # a ja c positiivisia ja yhdessä keskeltä, tai b ja d negatiivisia erikseen
                liita(R[0](), R[1]()); liita(R[2](), R[3]())
            else:
                liita(R[3](), R[0]()); liita(R[1](), R[2]())
    viivat, kayty = [], set()
    for alku in list(naapurit):
        if alku in kayty or len(naapurit[alku]) != 1:
            continue
        viivat.append(_kulje(alku, naapurit, kayty))
    for alku in list(naapurit):   # suljetut renkaat
        if alku not in kayty:
            v = _kulje(alku, naapurit, kayty)
            v.append(v[0])
            viivat.append(v)
    return [[pisteet[a] for a in v] for v in viivat if len(v) >= 2]


def _kulje(alku, naapurit, kayty):
    v, ed, p = [alku], None, alku
    kayty.add(alku)
    while True:
        seur = [q for q in naapurit[p] if q != ed and q not in kayty]
        if not seur:
            return v
        ed, p = p, seur[0]
        kayty.add(p)
        v.append(p)


def tarkenna(raja, viivat, kierroksia=3):
    """Käyrän pisteet tarkalle etäisyydelle: siirto lähimmästä perusviivan kohdasta poispäin niin, että etäisyys = 4 mpk.
    Ruudukon käyrä oikaisee kahden kaaren kohtaamiskohdan (kulma) jopa ~30 m liian kauas merelle [K, testi]; siirron jälkeen
    lähimmän janan etäisyys on 7408 m ja muiden vähintään yhtä suuri tai pienempi → viiva on kulmissa korkeintaan raja-alueen
    sisäpuolella (varovaisempi suunta: ulkopuolen sääntö on tiukempi)."""
    S = np.array([HS.tm35(a, b) + HS.tm35(c, d) for v in viivat for (a, b), (c, d) in zip(v[:-1], v[1:])])
    if not len(S):
        return raja
    e0, n0, e1, n1 = S[:, 0], S[:, 1], S[:, 2], S[:, 3]
    dx, dy = e1 - e0, n1 - n0
    L2 = np.where(dx * dx + dy * dy > 0, dx * dx + dy * dy, 1.0)
    out = []
    for v in raja:
        P = np.array(v)
        E, N = tm35_np(P[:, 0], P[:, 1])
        for _ in range(kierroksia):
            t = np.clip(((E[:, None] - e0) * dx + (N[:, None] - n0) * dy) / L2, 0, 1)
            qe, qn = e0 + t * dx, n0 + t * dy
            dd = np.hypot(E[:, None] - qe, N[:, None] - qn)
            m = np.argmin(dd, axis=1)
            r = np.arange(len(E))
            qe, qn, d = qe[r, m], qn[r, m], dd[r, m]
            tavoite = MPK_M * mittakaava(E)
            s_ = np.where(d > 0, tavoite / np.where(d > 0, d, 1.0), 1.0)
            E, N = qe + (E - qe) * s_, qn + (N - qn) * s_
        out.append([HS.tm35_latlon(float(e), float(n)) for e, n in zip(E, N)])
    return out


def rle(sisalla):
    """Rivit ajonpituuksina vuorotellen sisällä/ulkona, alkaen sisällä (ensimmäinen voi olla 0)."""
    out = []
    for r in sisalla:
        rivi, tila, n = [], True, 0
        for x in r.tolist():
            if x == tila:
                n += 1
            else:
                rivi.append(n); tila, n = x, 1
        rivi.append(n)
        out.append(rivi)
    return out


def viivan_pituus_km(v):
    return sum(math.hypot((b1 - b0) * 111.32 * math.cos(math.radians(a0)), (a1 - a0) * 110.574)
               for (a0, b0), (a1, b1) in zip(v[:-1], v[1:]))


def laske(viivat, alue, maa, loki=print):
    """Perusviivat [(lat, lon) ...] → rajat.json:n laskettu osa. Nostaa ValueErrorin, jos merenpuolta ei voi päätellä."""
    t0 = time.monotonic()
    G = ruudukko(alue)
    tiheat = [tihenna(v) for v in viivat]
    meri, este, tilasto = luokittele(G, tiheat, maa)
    d = etaisyys(G, viivat)   # alkuperäiset janat: etäisyys lasketaan TM35-tasossa tarkasti
    f = np.where(meri, np.where(np.isfinite(d), d - MPK_M, 1e7), -MPK_M)
    raja = tarkenna(kayra0(G, f), viivat)
    origo = (math.floor(G["lat0"] * 10) / 10, math.floor(G["lon0"] * 10) / 10)
    raja_k = [HS.koodaa(HS.yksinkertaista(v, TOLERANSSI_M), origo) for v in raja]
    perus_k = [HS.koodaa(HS.yksinkertaista(v, TOLERANSSI_M), origo) for v in tiheat]
    sisalla = ~meri | (d <= MPK_M)
    tilasto.update({"raja_viivoja": len(raja), "raja_km": round(sum(viivan_pituus_km(v) for v in raja), 1),
                    "perus_km": round(sum(viivan_pituus_km(v) for v in viivat), 1), "sisalla_osuus": round(float(sisalla.mean()), 3),
                    "ruudukko": f"{G['ny']}x{G['nx']}", "s": round(time.monotonic() - t0, 1)})
    loki(f"lohirajat: {tilasto}")
    return {"origo": list(origo), "kerroin": HS.KERROIN, "mpk_m": MPK_M,
            "perusviiva": [k for k in perus_k if len(k) >= 4], "raja4": [k for k in raja_k if len(k) >= 4],
            "ruudukko": {"lat0": G["lat0"], "lon0": G["lon0"], "dlat": G["dlat"], "dlon": G["dlon"],
                         "rivit": G["ny"], "sarakkeet": G["nx"], "rle": rle(sisalla)},
            "tilasto": tilasto}


# ---------------------------------------------------------------- haku
def laajenna(alue, km):
    ro = km * 1000 / (111320.0 * math.cos(math.radians(alue["lat_max"])))
    rl = km * 1000 / 110574.0
    return {"lat_min": round(alue["lat_min"] - rl, 4), "lat_max": round(alue["lat_max"] + rl, 4),
            "lon_min": round(alue["lon_min"] - ro, 4), "lon_max": round(alue["lon_max"] + ro, 4)}


def valitse_taso(nimet):
    """Perusviivan viivataso: avainsana nimessä (alaviivat ja välilyönnit ohitetaan); ei alue- (_A) eikä pistetasoa (_P);
    ensisijaisesti _L-päätteinen ja avainsanalistan järjestyksessä."""
    norm = lambda x: x.lower().replace("_", "").replace(" ", "")   # noqa: E731
    for avain in TASON_AVAIMET:
        a = norm(avain)
        ehd = [n for n in nimet if a in norm(n) and not n.lower().endswith(("_a", "_p"))]
        if ehd:
            return sorted(ehd, key=lambda n: (not n.lower().endswith("_l"), len(n)))[0]
    return None


def hae_perusviiva(alue, loki=print):
    """Perusviivan murtoviivat [(lat, lon), ...] alueen ympäriltä (HAKU_REUNA_KM). Palauttaa (viivat, taso, osoite)."""
    haku = laajenna(alue, HAKU_REUNA_KM)
    virheet = []
    for osoite in WFS:
        try:
            xml_teksti, _ = HS._hae(osoite, {"service": "WFS", "request": "GetCapabilities"}, 60)
            versio, nimet, muodot = HS.tasot_kyvyista(xml_teksti)
        except Exception as e:  # noqa: BLE001
            virheet.append(f"{osoite}: GetCapabilities {e}")
            continue
        kiinn = [n for n in nimet if any(s in n.lower() for s in ("territorial", "baseline", "limit", "zone", "aluevesi", "raja"))]
        loki(f"lohirajat: {osoite} WFS {versio}, {len(nimet)} tasoa; rajoihin liittyvät: {', '.join(kiinn)[:600]}")
        taso = valitse_taso(nimet)
        if not taso:
            virheet.append(f"{osoite}: ei perusviivatasoa")
            continue
        loki(f"  perusviivataso: {taso}")
        kohteet = HS.hae_kohteet(osoite, versio, taso, muodot, loki, None, haku)
        if not kohteet:
            virheet.append(f"{osoite}: {taso}: ei kohteita alueen ympäriltä")
            continue
        loki(f"  esimerkin ominaisuudet: {json.dumps(kohteet[0][2], ensure_ascii=False)[:300]}")
        a, b = next(p for k in kohteet for o in k[1] for p in o[:1])
        jarjestys = HS.tulkitse_jarjestys(a, b)
        viivat = [HS.muunna(o, jarjestys) for _, osat_, _ in kohteet for o in osat_ if len(o) >= 2]
        loki(f"  koordinaatit {jarjestys}; {len(viivat)} viivaa, {sum(len(v) for v in viivat)} pistettä")
        return viivat, taso, osoite
    raise ValueError(" | ".join(virheet)[:500] or "ei WFS-palvelua")


def _hae_vanha(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=OTSAKE), timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def paivita(kansio, sivun_osoite, loki=print, alue=None, kuvaus=None, nyt=None, hae_vanha=_hae_vanha, hae=hae_perusviiva):
    """Kirjoittaa kansio/rajat.json. Palauttaa tilan meri.json:iin: {tila, luotu?, viesti?}.
    alue = rajat (lat/lon), kuvaus = alueet.js:n alue (maapisteet)."""
    nyt = nyt or datetime.now(timezone.utc)
    polku = os.path.join(kansio, "rajat.json")
    vanha = None
    try:
        vanha = hae_vanha(sivun_osoite + "rajat.json")
    except Exception as e:  # noqa: BLE001
        loki(f"lohirajat: edellistä rajat.json:ia ei saatu ({e})")
    kelpaa = bool(vanha and vanha.get("versio") == VERSIO and vanha.get("alue") == alue and vanha.get("raja4") is not None)
    if kelpaa:
        try:
            ika = (nyt - datetime.strptime(vanha["luotu"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)).days
        except Exception:  # noqa: BLE001
            ika = 999
        if ika < UUSINTA_VRK:
            with open(polku, "w", encoding="utf-8") as f:
                json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
            loki(f"lohirajat: käytetään edellistä ({ika} vrk vanha)")
            return {"tila": "ok", "luotu": vanha["luotu"]}
    try:
        viivat, taso, osoite = hae(alue, loki)
        tulos = laske(viivat, alue, maapisteet(kuvaus), loki)
        sis = {"versio": VERSIO, "luotu": nyt.strftime("%Y-%m-%dT%H:%M:%SZ"), "alue": alue, "lahde": LAHDE, "huom": HUOM,
               "taso": taso, "wfs": osoite}
        sis.update(tulos)
        with open(polku, "w", encoding="utf-8") as f:
            json.dump(sis, f, ensure_ascii=False, separators=(",", ":"))
        loki(f"lohirajat: kirjoitettu {polku}, {os.path.getsize(polku) // 1024} kt")
        return {"tila": "ok", "luotu": sis["luotu"]}
    except Exception as e:  # noqa: BLE001
        virhe = str(e)[:300]
        loki(f"lohirajat: VIRHE {virhe}")
        if kelpaa:
            with open(polku, "w", encoding="utf-8") as f:
                json.dump(vanha, f, ensure_ascii=False, separators=(",", ":"))
            return {"tila": "vanha", "luotu": vanha["luotu"], "viesti": virhe}
        return {"tila": "virhe", "viesti": virhe}


if __name__ == "__main__":   # käsin: python hae_rajat.py kansio (Luoto)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    print(paivita(sys.argv[1] if len(sys.argv) > 1 else ".", "https://lohirosvo.github.io/merilohitutka/data/",
                  alue=dict(HS.ALUE)))
