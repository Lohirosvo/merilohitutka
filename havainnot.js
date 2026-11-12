/* Merilohitutka – havainnot.js (v15)
 * Hannun omat toistuvat havainnot Copernicus-mallikartoista. Kartan taso "Havainnot". JULKINEN tiedosto (GitHub).
 * Saalispisteitä EI tähän: ne tallennetaan vain puhelimeen (Raportit → Omat saalispisteet).
 * Hakasulkeiden [ ] välissä puhdasta JSONia (ei kommentteja, ei pilkkua viimeisen alkion jälkeen).
 *
 * tyyppi "viiva": "pisteet": [[lat, lon], ...], "leveys_km" (vyöhyke molemmin puolin),
 *                 "vahvistukset": [{ "lat": [min, max], "n": havaintoja, "teksti", "heikko": true = haalea }]
 * tyyppi "alue":  rajausruutu "lat": [min, max], "lon": [min, max]; kartalla ellipsi ruudun sisällä;
 *                 valinnainen "reuna" (ulompi ruutu katkoviivalla)
 * laji: "lammin" (oranssi), "kylma" (sininen), "muu" (violetti)
 *
 * Lähde: Hannun viesti 12.11.2026 klo 11.13 (lista toisesta keskustelusta).
 */
(typeof window !== 'undefined' ? window : globalThis).HAVAINNOT = [
  {
    "tyyppi": "viiva", "laji": "muu", "nimi": "Toistuva lämpöraja (malli)",
    "teksti": "mallikarttojen pintalämpörajan toistuva sijainti, ei ottipaikka", "lahde": "KASKIN1 11.5.2018",
    "leveys_km": 3,
    "pisteet": [[61.55, 21.287], [61.60, 21.312], [61.65, 21.288], [61.70, 21.267], [61.75, 21.284],
                [61.80, 21.268], [61.85, 21.215], [61.90, 21.188], [61.95, 21.173], [62.00, 21.157],
                [62.05, 21.115], [62.10, 21.128], [62.15, 21.172], [62.20, 21.174], [62.25, 21.146],
                [62.30, 21.077], [62.35, 21.033], [62.40, 21.008], [62.45, 20.986], [62.50, 20.957],
                [62.55, 20.937]],
    "vahvistukset": [
      { "lat": [61.60, 61.85], "n": "4", "teksti": "2014, 2015-piste, 2018, 2020" },
      { "lat": [61.85, 62.25], "n": "1–2", "teksti": "2018, 2015 osittain", "heikko": true },
      { "lat": [62.25, 62.42], "n": "5", "teksti": "2014, 2015, 2018, 2019, 2020" },
      { "lat": [62.42, 62.55], "n": "3", "teksti": "2018, 2019, 2020" }
    ]
  },
  {
    "tyyppi": "alue", "laji": "kylma", "nimi": "Etelä-Ahvenanmaan kylmä alue", "lyhyt": "toistuu 2000, 2016, 2020",
    "teksti": "6,6 °C ydin 19.5.2020 kartalla; toistuu vuosien 2000, 2016 ja 2020 kartoilla",
    "lat": [60.108, 60.159], "lon": [19.465, 19.648],
    "reuna": { "lat": [60.08, 60.19], "lon": [19.41, 19.68], "teksti": "7,0 °C reuna" }
  },
  {
    "tyyppi": "alue", "laji": "lammin", "nimi": "Gisslanin lämmin kieli", "lyhyt": "vain 19.5.2020",
    "teksti": "7,58 °C suljettu käyrä, noin 12 km pohjois–eteläsuunnassa ja 6 km leveä; vain yhdellä kartalla (19.5.2020), ei toistuva",
    "lat": [60.023, 60.132], "lon": [19.249, 19.359]
  }
];
