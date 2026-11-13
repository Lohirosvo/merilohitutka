/* Merilohitutka – alueet.js (v17)
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
 */
(typeof window !== 'undefined' ? window : globalThis).ALUEET = [
  {
    "tunnus": "luoto", "nimi": "Luoto–Tankar", "lyhyt": "Luoto", "polku": "",
    "rajat": { "lat_min": 63.45, "lat_max": 64.05, "lon_min": 22.05, "lon_max": 23.10 },
    "keski": [63.83, 22.62], "zoom": 10.6, "paluuikkuna": true,
    "asemat": ["Pietarsaari Kallan@63.7515,22.5228", "101661"],
    "tuulipisteet": [[63.55, 22.15], [63.55, 22.32], [63.55, 22.47], [63.70, 22.15], [63.70, 22.32], [63.70, 22.48],
                     [63.85, 22.15], [63.85, 22.35], [63.85, 22.55], [64.00, 22.20], [64.00, 22.45], [64.00, 22.70], [64.00, 22.95]],
    "merkit": [
      { "nimi": "Köpmanholmen", "lat": 63.806844, "lon": 22.671069, "muoto": "nelio", "vari": "#ffd54a" },
      { "nimi": "Kolmoispatti", "lat": 63.830822, "lon": 22.506817, "muoto": "kolmio", "vari": "#ff9d3a" },
      { "nimi": "Kallan", "lat": 63.751469, "lon": 22.522764, "vari": "#ffffff" },
      { "nimi": "Tankar", "lat": 63.951, "lon": 22.845, "vari": "#ffffff" }
    ]
  },
  {
    "tunnus": "vaasa", "nimi": "Vaasa", "lyhyt": "Vaasa", "polku": "vaasa/",
    "rajat": { "lat_min": 62.95, "lat_max": 63.32, "lon_min": 21.15, "lon_max": 21.80 },
    "keski": [63.12, 21.50], "zoom": 10.9, "paluuikkuna": false,
    "asemat": ["Mustasaari Valassaaret@63.430,21.070", "Maalahti Strömmingsbådan@62.979,20.741"],
    "merkit": [
      { "nimi": "Valassaaret", "lat": 63.430, "lon": 21.070, "vari": "#ffffff" },
      { "nimi": "Strömmingsbådan", "lat": 62.979, "lon": 20.741, "vari": "#ffffff" }
    ]
  },
  {
    "tunnus": "norrskar", "nimi": "Norrskär", "lyhyt": "Norrskär", "polku": "norrskar/",
    "rajat": { "lat_min": 63.05, "lat_max": 63.45, "lon_min": 20.30, "lon_max": 21.20 },
    "keski": [63.24, 20.80], "zoom": 10.4, "paluuikkuna": false,
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
    "asemat": ["Pori Tahkoluoto satama@61.644,21.337", "Rauma Kylmäpihlaja@61.145,21.303"],
    "merkit": [
      { "nimi": "Tahkoluoto", "lat": 61.644, "lon": 21.337, "vari": "#ffffff" }
    ]
  },
  {
    "tunnus": "eckero", "nimi": "Ahvenanmaa–Eckerö", "lyhyt": "Eckerö", "polku": "eckero/",
    "rajat": { "lat_min": 60.00, "lat_max": 60.42, "lon_min": 19.10, "lon_max": 20.00 },
    "keski": [60.20, 19.55], "zoom": 10.5, "paluuikkuna": false,
    "asemat": ["Hammarland Märket@60.301,19.131", "Jomala Jomalaby@60.122,19.898"],
    "merkit": [
      { "nimi": "Eckerö Berghamn", "lat": 60.225, "lon": 19.537, "muoto": "nelio", "vari": "#ffd54a" },
      { "nimi": "Märket", "lat": 60.301, "lon": 19.131, "vari": "#ffffff" },
      { "nimi": "Jomalaby", "lat": 60.122, "lon": 19.898, "vari": "#ffffff" }
    ]
  }
];
