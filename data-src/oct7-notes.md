# oct7_v2 – uncertain items and open leads

Generated 2026-10-02. See `oct7_v2.json` (existing 53 records with `scope` added, plus new records).

## Shortfall
The target was 60+ new verified records; the file has far fewer (see counts in the handback). The session's WebSearch quota (200 calls, shared by all research agents) ran out about 8 minutes into the work, and several news sites returned 403 to direct fetches. Rather than add records that could not be confirmed, unverified candidates are listed below as leads.

## Precision policy
- New records are `exact` only when two coordinate sources agree within ~80 m (OSM + Wikidata, or OSM + geotagged Commons photo). Most new records have a single coordinate source and are `approx`.
- Several **existing** records are marked `exact` on the strength of an OSM node alone (e.g. hillel-memorial-corner, karmiel-nova-memorial, yokneam-oct7-memorial, katzrin-heroes-lookout, mitzpe-segev-schwartz, mitzpe-eliso, mitzpe-yiftach-gorni, ido-shani-lookout, mitzpe-uri-negev, givat-kobi-lookout-sderot, nova-bridge-petah-tikva). Under the brief's rule these should be downgraded to `approx`. They were left unchanged here.

## Scope calls on existing records worth a second look
- `givat-kobi-lookout-sderot`: scope `war-later`. It is not a memorial at all, just a long-standing lookout over Gaza. Recommend hiding it on an Oct 7-only map.
- `black-arrow-memorial`, `dangour-memorial-sufa`: scope `oct7` because they are Oct 7 battle sites, but both are pre-existing memorials for 1950s/1948 fallen, not Oct 7 memorials.
- `har-herzl-terror-victims-memorial`: scope `mixed`. It is a national memorial to all terror victims; Oct 7 names were added and the 2025 state ceremony was held there.
- `katzrin-heroes-lookout`: scope `war-later`. Unverified whether any Katzrin resident fell on Oct 7 itself; if one did, it should be `mixed`.
- `ketav-vashem-kfar-aza`: scope `oct7`. It may also list members who died later in captivity.
- `community-netiv-haasara`: its note says no memorial was verified. A memorial now exists (new record `netiv-haasara-victims-memorial`).

## Uncertain new records
- `akevot-bibas-tzeelim`: scope `oct7`. Shiri, Ariel and Kfir Bibas were abducted on Oct 7 and murdered in captivity, so they did not die on Oct 7 itself.
- `itay-moreno-lookout-adderet`: he.wikipedia says he fell in the battle of Zikim in "October 2023" without a day. The battle of Zikim was on Oct 7, but the date is not directly confirmed.
- `amit-lookout-ness-ziona`: Wikipedia says it was inaugurated April 2024; Wikidata P571 says 2025-07. Used 2024.
- `ilay-gamzo-shelter-ashdod`: the Wikidata coordinate and the Commons photo GPS are ~300 m apart.
- `izabella-gandlin-shelter-ashdod`, `or-moses-shelter-ashdod`, `gan-nissim-lod`: the only coordinate source is Commons photo GPS.
- `avshalom-police-memorial-corner`: the corner exists per a Commons photo, but its spot inside the village is unknown. The point is the village centroid.
- `asaf-hamami-bridge-petah-tikva`: the bridge itself is not named in OSM; the point is the bus stop named for it.
- `givat-hatatzpitaniyot-petah-tikva`: the point is a Nominatim street position on Arlozorov St. The year 2025 comes from the photo date, not from an inauguration source.
- `ramat-gan-har-habanim-iron-swords`: combines the Iron Swords memorial (photo GPS) with the adjacent terror-victims memorial, where Oct 7 victims are commemorated. They may be one site or two.
- `tatzpit-hagvura-sderot`: scope `mixed`. Sources disagree on the officer's rank, so it is omitted.
- `guy-iluz-corner-magen-junction`: the corner's exact position inside the Paz station is unknown.
- `ofakim-fallen-police-memorial`: the point is a street centroid (~150 m). Officer names are omitted.
- `tel-haela-amichai-lookouts`: scope `mixed`. Three men named Amichai fell on Oct 7, and Amishar Ben-David fell in March 2024. OSM's "תשפ"ג" is a year error.
- `mitzpe-moti-shamir-adora`: other lookouts for the same person exist elsewhere (e.g. Havat Yair); only the Adora one is included.
- All OSM-only lookouts from agents B and D are `approx`.

## Dropped as duplicate or tentative
- `chen-buchris-corner-ashdod`: duplicate of `chen-bouchris-memorial-ashdod`.
- `phoenix-monument-shoham`: the "עוף החול" bronze in Gan HaGvura, Shoham, exists, but it was not confirmed that any of the Shoham fallen it commemorates died on Oct 7.

## Rejected (not Oct 7)
- Yonatan Luber plaque: fell 25 Dec 2023.
- מצפה ארץ הצבי (Zvika Lavi): died of wounds on 11 Dec 2023.
- מצפה עמרי כהן, Ashdod: fell Dec 2024.
- מצפה אייל (probably Eyal Twito): fell Jan 2024.
- מצפה הראל: fell Dec 2023.
- Liel Hayo bench, Shoham: fell Dec 2023.
- מצפה שאולי: fell Dec 2023.
- מצפה יהונתן (Meron disaster).
- Mitzpe Assaf, Tel Bahan: fell Nov 2023.
- Yaheli trail, Rakefet: fell Dec 2023.
- Daniel Ben Harush lookout, Alon: fell Dec 2023.
- Niv Aios corner, Jerusalem: died 8 Oct 2023.
- Ariel Ohana lookout, Revadim: fell 8 Oct 2023 in the battle for Be'eri. Could be added as `oct7` if the battle-for-Be'eri fallen are in scope.
- Kamay Ahiel, Salman Habaka, Omer Balva, Ilay Tzeir.
- מצפה רנה סעד (2019 attack) and מצפור יונתן ורמולן (2000).

## Leads (exist, or the person died on Oct 7, but not verified enough to include)
- OSM-only, with no independent source found:
  - "בשביל עילי" (Eili Bar-Sade, n11674095376)
  - Romi Eliyahu Burnett bench (n13938455402)
  - "מצפה רועי נגרי" (n14018652969, a second Roi Negri site near 32.224,34.818)
  - "מצפה עמיחי" (n13159359201)
  - "תצפית ענר שפירא" (n12759624701; Aner Shapira died on Oct 7)
  - Zisser/Tal corner (n13397386901; mixed at best)
- Eili Zisser and Hadar Kama memorial (Sayeret Matkal, Kfar Aza): exists per a Commons photo, location unknown.
- Givat Roi for Col. Roi Levy, Horvat Avimor: exists per a Commons photo, no coordinates.
- Safra and Saifa Square, Ashdod (Gil Daniels): has Wikidata coordinates, but his date of death was not confirmed.
- "Never forget and never forgive" mural, Ashdod (ONE LOVE, Oct 2023): has Wikidata, but it may have been temporary.
- Grove of the Fallen, Ramat HaSharon; Kafe Lior memorial, Givat Haim Ihud; Holon Shai Square.
- Kalaniot installations in Yehud, Haifa and the Rabin Center: possibly temporary.
- Route 232 roadside memorials (Davar article 489994): Liraz Assulin & Eden Gez north of Mefalsim; the Re'im parking entrance; "Barli" (Bar Lior); Yonatan Tzur on Route 241; an anonymous memorial near Be'eri. These exist, but there are no coordinates.
- Kipa list items not checked:
  - Hanan Drori bench (Abu Tor)
  - Aviatar Ohayon garden (Alyn, Jerusalem)
  - Eitan Fish spring (Retamim)
  - Binyamin Arli garden
  - Ariel Eliyahu lookout, Har Eival
  - Shilo Har-Even bench, Akko–Nahariya coast
- Unidentified recent `historic=memorial` OSM nodes near the envelope, with no name: n13141629296 (near Nirim/Nir Oz), n13198807668 and n13198834668 (Kerem Shalom area), n13089137878 (Sderot), n13241332672 (near Nova), n13427512146 (Ashkelon area).
- Nova compound sub-features in OSM (הבר הקטן, הבמה המרכזית, חפ"ק המשטרה) are inside the existing Nova memorial record and were not added separately.
- `שרידי קרקל פגוע` (n12223010634, near Be'eri) and `זחלילית` (n13207657854, Kfar Aza): purpose unconfirmed.

## City memorials (agent A): caveats and future dates
- `arad-iron-swords-monument`: scope `mixed` follows the source's wording. It was not checked whether any Arad resident died on Oct 7 itself, and a Haaretz/Van Leer blog argues the monument sidesteps Oct 7. Point is an older memorial node in the same garden (~50–200 m).
- `ness-ziona-memorial-garden`: point is a street centroid (~300 m). Inaugurated 26 May 2026.
- `ashdod-cemetery-oct7-memorial`: point is the cemetery centroid (~400 m). The memorial is in plot ש6.
- Not built yet, so not included; re-check after the dates:
  - Netanya "Gan El HaOfek": inauguration 5 Oct 2026
  - Rishon LeZion memorial site, Tommy Lapid 8: 7 Oct 2026
  - Bat Yam monument: 5 Oct 2026
- Ofakim "Derech HaGiborot" (KKL, Jan 2024): excluded because it honours living women's heroism, not the dead.
- Not researched because the search quota ran out: city memorials in Netivot, Kiryat Gat, Dimona, Be'er Sheva, Rahat, Holon, Kfar Saba, Ra'anana, Modi'in and Eilat, and regional-council sites.
