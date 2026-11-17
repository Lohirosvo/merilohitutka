/* Merilohitutka – alueet.js (v33)
 * Kalastusalueet. Yksi lähde: sovellus lataa tämän skriptinä ja hae_copernicus.py lukee saman tiedoston.
 * Hakasulkeiden [ ] välissä on oltava puhdasta JSONia (ei kommentteja, ei pilkkua viimeisen alkion jälkeen).
 *
 * lyhyt: nimi kartan aluevalinnassa.
 * polku: datakansio data/-kansion alla ("" = data/ suoraan, Luoto v5:stä lähtien).
 * rajat: Copernicus-, syvyys- ja väylähaun alue (lat_min, lat_max, lon_min, lon_max).
 * asemat: IL:n havaintoasemat tuulihälytykseen, "Nimi@lat,lon" (lähin tuulta mittaava asema haetaan)
 *         tai fmisid-numero.
 * tuulipisteet: kiinteät IL-ennustepisteet merellä; puuttuessa haku valitsee ne mallin meriruuduista.
 * Koordinaattien lähteet: Hannun antamat (Luoto), Valassaaret 63°25,8' 21°04,2' (meteonews),
 * Strömmingsbådan 62,9794 20,7407 (windy.app), Kristiinankaupunki Majakka 62,2031 21,1731 (Berkeley Earth),
 * Sälgrund 62°20,1' 21°11,6' (visitkaskinen.fi), Norrskär 63,2367 20,6108 (marinelink).
 * Märket 60,3010 19,1314, Gisslan 60,1889 19,4504 (v15: merkki havainnot.js:ssä), Eckerö Berghamn 60,225 19,537 (Wikipedia);
 * Jomala Jomalaby = Maarianhaminan lentoasema, koordinaatti muistista (ei tarkistettu, haku etsii lähimmän aseman).
 * Kaskinen (v17): Sälgrundin asema poistettu – Windfinderin mukaan asema ei enää raportoi (havainnot 3/2017–9/2024),
 * mikä on todennäköinen syy Hannun ilmoitukseen 13.11. "osa hauista epäonnistui" (virheilmoitusta ei nähty). Sälgrund jää kartalle maamerkiksi.
 * Pori (v15): rajat Hannun listasta 12.11.2026. Tahkoluoto 61,644 21,337 (windy.app, likimääräinen; IL:n asema
 * "Pori Tahkoluoto Harbour" mittaa tuulta, tide-forecast.com). Rauma Kylmäpihlaja muistista (ei tarkistettu).
 * Uusien alueiden rajat on arvioitu Hannun karttakuvista 10.11.2026.
 * v22 (Hannu 14.11.2026): Vaasa laajennettu kattamaan Mikkelinsaaret (Kummelskärin luontoasema 63°27,643' 21°46,347',
 * luontoon.fi; saariryhmän laajuus arvioitu) ja Luoto itään Lohtajalle (Lohtaja 64,0236 23,5056 ja Ohtakari 64,0905 23,4053,
 * Wikipedia). tuulipisteetLisaa: kiinteiden pisteiden lisäksi haku lisää mallin meriruuduista pisteet alueen osiin,
 * jotka ovat yli 10 km:n päässä kiinteistä (Lohtajan suunta).
 * v24 (Hannu 15.11.2026): lahtopisteet = merisään lähtö- ja paluupisteet, ensimmäinen = oletus (kun yli 50 km).
 *   tyyppi "turva": piste on jo turvallisessa vedessä (Luoto: "nämä vie turvalliseen veteen asti ei luiskalle") → reitti suoraan;
 *   "luiska": väylää pitkin asetuksen syvyyskäyrälle, sitten suoraan. kautta = pakollinen välipiste (Reposaari: "aina aallonmurtajan
 *   kautta"). jatko = sisäosuus satamaan (Luoto → Köpmanholmen). minne/mista = nimen taivutus puheeseen.
 *   lahtopisteetAlueelta: alue käyttää toisen alueen pisteitä (v24: Norrskär → Vaasa; v25 alkaen ei käytössä).
 *   turvasatamat (v25, Hannu 15.11.: Norrskär "turvasatama/yöpymispaikka"): ei lähtöpiste; kovalla kelillä paluu lähimpään suojaan
 *   (alueen lähtöpisteet ja turvasatamat). tyyppi "turva" → reitti suoraan tai syvän veden kautta, satamaa ympäröivät 300 m sallitaan.
 *   suoraMatala (v26, Hannu 15.11.: Norrskärin alueella voi olla karttaan merkitsemätöntä matalaa pintaan asti, pysytään väylällä
 *   tai yli 10 m:n vedessä; "Vain Norrskär"): väylän ulkopuolinen reittiosuus kiertää tämän syvyiset ja matalammat käyrät
 *   (asetusta ei käytetä pienempänä kuin tämä).
 *   silakka (v27, silakkatietopohja v006 kohta 1.1): silakan valokerros tälle alueelle (ensin Luoto–Tankar). hae_copernicus.py
 *   hakee valon vaimennuksen (BGC kd, zsd) ja mallin pohjan. kdOletus = Kd(PAR), jos mallin arvoa ei ole (Perämeren avomeren
 *   kesän Secchi 4,73 m → 1,7/4,73 = 0,36, tietopohja [K]).
 *   kausi (v28): lohikausi ['KK-PP', 'KK-PP'] (tietopohja 0.1: 1.5.–31.8.); sen ulkopuolella vaihemalli näytetään vain laskentana.
 *   paiva (v29): 'taulukko' = Luodon taulukon päivä-/yösäännöt (tietopohja 3.1), 'valo' = kohdan 2 yleissääntö (3.3 Kaskinen).
 *   vaiheet (v29): pohjan syvyys [min, optMin, optMax, max] vaiheittain (odottava, kutu, syonnos); puuttuu = Luodon arvot.
 *   kohta (v30): tietopohjan kohta, josta alueen vaiheet ovat (näkyy napautuksen alaviitteessä).
 *   malli (v31): "saannot" = vaiheet ehtoina (silakka.js vaiheetSaannoista): pinta / t5 (5 m:n lämpö) / pt (pohja) °C-välit ja
 *   pvm ['KK-PP', 'KK-PP']; ellei = vaihe pois, jos jokin luetelluista on voimassa. Puuttuu = pohjan lämpömalli (Luoto, Kaskinen).
 *   Vaasa ja Norrskär (v31): tietopohja 3.2 (Ehnholm 1951, aineisto 1938–49 [L1]); Kd 0,31 (Merenkurkun Secchi 5,50 m → 1,7/5,50).
 *   Päivämäärärajat ovat 1940-luvun aineistosta ja kutu on sen jälkeen aikaistunut (~7,7 vrk/vuosikymmen [L35]) → lämpöehdot
 *   ensisijaisia; "odottava" kauden alusta (ei 15.5.), korkeakesän kutu "pinta yli 14 °C" heinäkuussa [A].
 *   Eckerö (v32): tietopohja 3.4. Silakka + kilohaili; kausi 1.5.–15.6. (lohen ohitus toukokuu–kesäkuun alku [L43, K]);
 *   Kd 0,31 (Ahvenanmeren Secchi 5,40 m). Säännöissä paiva/yo = vaiheen päivä- ja yösääntö (silakka.js saantoKerros):
 *   harppaus = harppauskerroksen alla, syvanteet = viereisissä syvänteissä, matalikko = kutumatalikolla, pinta20 = ylin 20 m
 *   jos pinta ≥ 5 °C. Kutu pohjan lämmöstä 8–14 °C [L1, L2, L4; Eckerön oma aineisto puuttuu → A]; syönnös aina kaudella [A];
 *   kilohaili jos pohja ≥ 5 °C ja pohjan happi ≥ 1 ml/l [L12, L13; pohjan arvot syvän kerroksen likiarvona A].
 *   happi (v32): haetaan pohjan happi (Copernicus BGC o2b).
 *   Pori (v33, Hannu 17.11. "Tehdään niin"): ei tietopohjassa → Kaskisen asetukset (sama Selkämeri, osa-alue 30) [A].
 *   Kutu Porin edustalla todettu (Tahkoluoto, Alleco 2020: mätiä löytyi; syyskudun selvitys tehty, tulos tarkistamatta) [L].
 *   Kokemäenjoen sameampi vesi → Copernicuksen Kd voi olla liian pieni, kerros liian syvällä [A]. Syyskutu jää kauden ulkopuolelle.
 *   Kaskinen–Kristiinankaupunki (v29): tietopohja 3.3, Kd 0,32 (Selkämeren Secchi 5,29 m → 1,7/5,29).
 *   Koordinaatit Hannun antamat (asteet, minuutit, sekunnit).
 * v23: Ohtakari toiseksi paluukohteeksi (Hannu 14.11.); merkki satamaan 64,08944 23,40594 (predictwind.com), paluukohteen tyyli.
 */
(typeof window !== 'undefined' ? window : globalThis).ALUEET = [
  {
    "tunnus": "luoto", "nimi": "Luoto–Tankar", "lyhyt": "Luoto", "polku": "",
    "rajat": { "lat_min": 63.45, "lat_max": 64.13, "lon_min": 22.05, "lon_max": 23.65 },
    "keski": [63.83, 22.62], "zoom": 10.6, "paluuikkuna": true, "tuulipisteetLisaa": true,
    "silakka": { "kdOletus": 0.36, "kausi": ["05-01", "08-31"], "paiva": "taulukko", "kohta": "3.1" },
    "lahtopisteet": [
      {"nimi": "Luoto", "minne": "Luodon pisteeseen", "mista": "Luodon pisteestä", "tyyppi": "turva", "lat": 63.8352, "lon": 22.646742, "jatko": {"nimi": "Köpmanholmen", "minne": "Köpmanholmeniin", "lat": 63.806844, "lon": 22.671069}},
      {"nimi": "Etelä", "minne": "eteläiseen pisteeseen", "mista": "eteläisestä pisteestä", "tyyppi": "turva", "lat": 63.613219, "lon": 22.480039},
      {"nimi": "Pietarsaari", "minne": "Pietarsaaren pisteeseen", "mista": "Pietarsaaren pisteestä", "tyyppi": "turva", "lat": 63.738158, "lon": 22.561789}
    ],
    "asemat": ["Pietarsaari Kallan@63.7515,22.5228", "101661"],
    "tuulipisteet": [[63.55, 22.15], [63.55, 22.32], [63.55, 22.47], [63.70, 22.15], [63.70, 22.32], [63.70, 22.48],
                     [63.85, 22.15], [63.85, 22.35], [63.85, 22.55], [64.00, 22.20], [64.00, 22.45], [64.00, 22.70], [64.00, 22.95]],
    "merkit": [
      { "nimi": "Köpmanholmen", "lat": 63.806844, "lon": 22.671069, "muoto": "nelio", "vari": "#ffd54a" },
      { "nimi": "Kolmoispatti", "lat": 63.830822, "lon": 22.506817, "muoto": "kolmio", "vari": "#ff9d3a" },
      { "nimi": "Kallan", "lat": 63.751469, "lon": 22.522764, "vari": "#ffffff" },
      { "nimi": "Tankar", "lat": 63.951, "lon": 22.845, "vari": "#ffffff" },
      { "nimi": "Ohtakari", "lat": 64.08944, "lon": 23.40594, "muoto": "nelio", "vari": "#ffd54a" }
    ]
  },
  {
    "tunnus": "vaasa", "nimi": "Vaasa", "lyhyt": "Vaasa", "polku": "vaasa/",
    "rajat": { "lat_min": 62.95, "lat_max": 63.56, "lon_min": 21.15, "lon_max": 22.00 },
    "keski": [63.12, 21.50], "zoom": 10.9, "paluuikkuna": false,
    "silakka": { "kdOletus": 0.31, "kausi": ["05-01", "08-31"], "paiva": "valo", "kohta": "3.2", "malli": "saannot",
      "vaiheet": [
        {"tunnus": "odottava", "nimi": "kutua odottava", "pvm": ["05-01", "07-15"], "ellei": ["kutuSisa", "kutuUlko", "kutuKesa", "kutuAvo"], "pohja": [5, 10, 20, 30]},
        {"tunnus": "kutuSisa", "nimi": "kutu, sisäsaaristo", "pinta": [11, 15], "pohja": [0, 1, 4, 5]},
        {"tunnus": "kutuUlko", "nimi": "kutu, ulkosaaristo", "t5": [8, 12], "pohja": [4, 5, 10, 12]},
        {"tunnus": "kutuKesa", "nimi": "korkeakesän kutu, ulkosaaristo", "pinta": [14, 40], "pvm": ["07-01", "07-31"], "pohja": [4, 5, 10, 12]},
        {"tunnus": "kutuAvo", "nimi": "kutu, avomerivyöhyke", "pvm": ["06-01", "06-30"], "pohja": [2, 5, 15, 20]},
        {"tunnus": "nuoret", "nimi": "nuoret syönnöksellä", "pvm": ["06-15", "08-31"], "pohja": [2, 5, 15, 20]}
      ] },
    "lahtopisteet": [
      {"nimi": "Raippaluodon silta", "minne": "Raippaluodon sillalle", "mista": "Raippaluodon sillalta", "tyyppi": "luiska", "lat": 63.206742, "lon": 21.48695},
      {"nimi": "Åminne", "minne": "Åminneen", "mista": "Åminnestä", "tyyppi": "luiska", "lat": 62.974208, "lon": 21.480453}
    ],
    "asemat": ["Mustasaari Valassaaret@63.430,21.070", "Maalahti Strömmingsbådan@62.979,20.741"],
    "merkit": [
      { "nimi": "Valassaaret", "lat": 63.430, "lon": 21.070, "vari": "#ffffff" },
      { "nimi": "Strömmingsbådan", "lat": 62.979, "lon": 20.741, "vari": "#ffffff" },
      { "nimi": "Mikkelinsaaret", "lat": 63.4607, "lon": 21.7725, "vari": "#ffffff" }
    ]
  },
  {
    "tunnus": "norrskar", "nimi": "Norrskär", "lyhyt": "Norrskär", "polku": "norrskar/",
    "rajat": { "lat_min": 63.05, "lat_max": 63.45, "lon_min": 20.30, "lon_max": 21.20 },
    "keski": [63.24, 20.80], "zoom": 10.4, "paluuikkuna": false, "suoraMatala": 10,
    "silakka": { "kdOletus": 0.31, "kausi": ["05-01", "08-31"], "paiva": "valo", "kohta": "3.2", "malli": "saannot",
      "vaiheet": [
        {"tunnus": "odottava", "nimi": "kutua odottava", "pvm": ["05-01", "07-15"], "ellei": ["kutuSisa", "kutuUlko", "kutuKesa", "kutuAvo"], "pohja": [5, 10, 20, 30]},
        {"tunnus": "kutuSisa", "nimi": "kutu, sisäsaaristo", "pinta": [11, 15], "pohja": [0, 1, 4, 5]},
        {"tunnus": "kutuUlko", "nimi": "kutu, ulkosaaristo", "t5": [8, 12], "pohja": [4, 5, 10, 12]},
        {"tunnus": "kutuKesa", "nimi": "korkeakesän kutu, ulkosaaristo", "pinta": [14, 40], "pvm": ["07-01", "07-31"], "pohja": [4, 5, 10, 12]},
        {"tunnus": "kutuAvo", "nimi": "kutu, avomerivyöhyke", "pvm": ["06-01", "06-30"], "pohja": [2, 5, 15, 20]},
        {"tunnus": "nuoret", "nimi": "nuoret syönnöksellä", "pvm": ["06-15", "08-31"], "pohja": [2, 5, 15, 20]}
      ] },
    "lahtopisteet": [
      {"nimi": "Klubbskat", "minne": "Klubbskatiin", "mista": "Klubbskatista", "tyyppi": "luiska", "lat": 63.305153, "lon": 21.093697}
    ],
    "turvasatamat": [
      {"nimi": "Norrskärin satama", "minne": "Norrskärin satamaan", "mista": "Norrskärin satamasta", "tyyppi": "turva", "lat": 63.235661, "lon": 20.614439, "yopyminen": true}
    ],
    "asemat": ["Mustasaari Valassaaret@63.430,21.070", "Maalahti Strömmingsbådan@62.979,20.741"],
    "merkit": [
      { "nimi": "Norrskär", "lat": 63.2367, "lon": 20.6108, "muoto": "kolmio", "vari": "#ff9d3a" },
      { "nimi": "Valassaaret", "lat": 63.430, "lon": 21.070, "vari": "#ffffff" },
      { "nimi": "Strömmingsbådan", "lat": 62.979, "lon": 20.741, "vari": "#ffffff" }
    ]
  },
  {
    "tunnus": "kaskinen", "nimi": "Kaskinen–Kristiinankaupunki", "lyhyt": "Kaskinen–Kristiinank.", "polku": "kaskinen/",
    "rajat": { "lat_min": 62.12, "lat_max": 62.65, "lon_min": 20.85, "lon_max": 21.65 },
    "keski": [62.36, 21.25], "zoom": 10.3, "paluuikkuna": false,
    "silakka": { "kdOletus": 0.32, "kausi": ["05-01", "08-31"], "paiva": "valo", "kohta": "3.3",
                 "vaiheet": { "odottava": [5, 10, 25, 40], "kutu": [0.5, 3, 10, 15], "syonnos": [10, 20, 40, 60] } },
    "lahtopisteet": [
      {"nimi": "Kaskinen", "minne": "Kaskisten luiskalle", "mista": "Kaskisten luiskalta", "tyyppi": "luiska", "lat": 62.382847, "lon": 21.218158}
    ],
    "asemat": ["Kristiinankaupunki Majakka@62.203,21.173"],
    "merkit": [
      { "nimi": "Sälgrund", "lat": 62.335, "lon": 21.193, "vari": "#ffffff" },
      { "nimi": "Kristiinankaupunki majakka", "lat": 62.203, "lon": 21.173, "vari": "#ffffff" }
    ]
  },
  {
    "tunnus": "pori", "nimi": "Pori", "lyhyt": "Pori", "polku": "pori/",
    "rajat": { "lat_min": 61.40, "lat_max": 61.90, "lon_min": 20.85, "lon_max": 21.60 },
    "keski": [61.65, 21.28], "zoom": 10.3, "paluuikkuna": false,
    "silakka": { "kdOletus": 0.32, "kausi": ["05-01", "08-31"], "paiva": "valo", "kohta": "3.3, Porille sovellettu",
                 "vaiheet": { "odottava": [5, 10, 25, 40], "kutu": [0.5, 3, 10, 15], "syonnos": [10, 20, 40, 60] } },
    "lahtopisteet": [
      {"nimi": "Reposaaren luiska", "minne": "Reposaaren luiskalle", "mista": "Reposaaren luiskalta", "tyyppi": "luiska", "lat": 61.615497, "lon": 21.44245, "kautta": {"nimi": "Reposaaren aallonmurtaja", "teksti": "aallonmurtajan kautta", "lat": 61.599539, "lon": 21.458564}},
      {"nimi": "Reposaaren aallonmurtaja", "minne": "Reposaaren aallonmurtajalle", "mista": "Reposaaren aallonmurtajalta", "tyyppi": "luiska", "lat": 61.599539, "lon": 21.458564}
    ],
    "asemat": ["Pori Tahkoluoto satama@61.644,21.337", "Rauma Kylmäpihlaja@61.145,21.303"],
    "merkit": [
      { "nimi": "Tahkoluoto", "lat": 61.644, "lon": 21.337, "vari": "#ffffff" }
    ]
  },
  {
    "tunnus": "eckero", "nimi": "Ahvenanmaa–Eckerö", "lyhyt": "Eckerö", "polku": "eckero/",
    "rajat": { "lat_min": 60.00, "lat_max": 60.42, "lon_min": 19.10, "lon_max": 20.00 },
    "keski": [60.20, 19.55], "zoom": 10.5, "paluuikkuna": false,
    "silakka": { "kdOletus": 0.31, "kausi": ["05-01", "06-15"], "paiva": "valo", "kohta": "3.4", "malli": "saannot", "happi": true,
      "vaiheet": [
        {"tunnus": "kutu", "nimi": "silakka, kutu", "pt": [8, 14], "pohja": [0.5, 3, 10, 15], "paiva": "syvanteet", "yo": "matalikko"},
        {"tunnus": "syonnos", "nimi": "silakka, syönnös", "pohja": [20, 40, 80, 150], "paiva": "harppaus", "yo": "valo"},
        {"tunnus": "kilohaili", "nimi": "kilohaili", "pt": [5, 40], "o2": [1, 99], "pohja": [20, 40, 100, 200], "paiva": "harppaus", "yo": "pinta20"}
      ] },
    "lahtopisteet": [
      {"nimi": "Torp", "minne": "Torpin luiskalle", "mista": "Torpin luiskalta", "tyyppi": "luiska", "lat": 60.180297, "lon": 19.598986},
      {"nimi": "Eckerö meripelastus", "minne": "Eckerön meripelastuskeskukselle", "mista": "Eckerön meripelastuskeskukselta", "tyyppi": "luiska", "lat": 60.219206, "lon": 19.538847}
    ],
    "asemat": ["Hammarland Märket@60.301,19.131", "Jomala Jomalaby@60.122,19.898"],
    "merkit": [
      { "nimi": "Eckerö Berghamn", "lat": 60.225, "lon": 19.537, "muoto": "nelio", "vari": "#ffd54a" },
      { "nimi": "Märket", "lat": 60.301, "lon": 19.131, "vari": "#ffffff" },
      { "nimi": "Jomalaby", "lat": 60.122, "lon": 19.898, "vari": "#ffffff" }
    ]
  }
];
