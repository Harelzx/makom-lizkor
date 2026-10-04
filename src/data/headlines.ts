// Three years in headlines, for the opening's count. Each one is written in our own words, short and factual,
// and links to the report it rests on. Photos are freely licensed from Wikimedia Commons, cropped and scaled down,
// and credited in "About" (public/headlines/). Every photo was chosen against the same lines: no images from the
// handover ceremonies in Gaza, no identifiable faces of hostages or families caught in a private moment, no
// political signs. A headline with no photo has none on purpose.

export interface HeadlinePhoto {
  file: string
  author: string
  license: string
  license_url: string
  url: string
}

export interface Headline {
  /** Places the headline on the count. */
  date: string
  /** Shown instead of the exact date when the day itself isn't the point. */
  when?: string
  text: string
  source: { label: string; url: string }
  photo?: HeadlinePhoto
  /** Set as a mourning notice: black, no photo. */
  mourning?: true
  /** Kept on a phone, where only ten fit. */
  phone?: true
}

const commons = (file: string, author: string, license: string, version: string, page: string): HeadlinePhoto => ({
  file,
  author,
  license,
  license_url: `https://creativecommons.org/licenses/${license.toLowerCase().includes("sa") ? "by-sa" : "by"}/${version}`,
  url: `https://commons.wikimedia.org/wiki/File:${page}`,
})

export const HEADLINES: Headline[] = [
  {
    date: "2023-11-24",
    text: "העסקה הראשונה: 105 חטופים חוזרים הביתה",
    source: { label: "ויקיפדיה", url: "https://en.wikipedia.org/wiki/2023_Gaza_war_ceasefire" },
    photo: commons("first-deal.webp", "ליזי שאנן", "CC BY 2.5", "2.5", "99903_the_kidnapped_square_PikiWiki_Israel.jpg"),
    phone: true,
  },
  {
    date: "2024-01-14",
    text: "100 ימים. 120 אלף בכיכר החטופים",
    source: {
      label: "The Times of Israel",
      url: "https://www.timesofisrael.com/were-done-enough-120k-attend-24-hour-rally-marking-100-days-since-hostages-taken/",
    },
    photo: commons(
      "100-days.webp",
      "U.S. Embassy Jerusalem",
      "CC BY 2.0",
      "2.0",
      "Ambassador_Jack_Lew_Speaks_at_the_100_Days_Memorial_for_hostages_at_Hostage_Square_in_Tel_Aviv,_Israel_on_January_13,_2024_-_2.jpg",
    ),
    phone: true,
  },
  {
    date: "2024-02-12",
    text: "חילוץ לילי ברפיח: פרננדו ולואיס בבית",
    source: { label: "ויקיפדיה", url: "https://en.wikipedia.org/wiki/2024_Rafah_hostage_raid" },
    photo: commons("rafah.webp", "דובר צה״ל", "CC BY-SA 3.0", "3.0", "Operation_Golden_Hand,_February_2024._XIV.jpg"),
  },
  {
    date: "2024-06-08",
    text: "מבצע ארנון: נועה, אלמוג, אנדריי ושלומי חולצו",
    source: { label: "The Jerusalem Post", url: "https://www.jpost.com/israel-news/article-808051" },
    photo: commons(
      "arnon.webp",
      "Chenspec",
      "CC BY-SA 4.0",
      "4.0",
      "Marking_the_abductees_who_returned_to_their_home_in_the_city_of_Yehud,_October_2024_01.jpg",
    ),
    phone: true,
  },
  {
    date: "2024-08-27",
    text: "קאיד פרחאן אלקאדי חולץ ממנהרה",
    source: { label: "ויקיפדיה", url: "https://en.wikipedia.org/wiki/Rescue_of_Qaid_Farhan_al-Qadi" },
    photo: commons("alkadi.webp", "דובר צה״ל", "CC BY-SA 3.0", "3.0", "Rescue-of-Farhan-Qadi-0002.jpg"),
  },
  {
    date: "2024-09-01",
    text: "שישה חטופים נרצחו בשבי. מדינה שלמה באבל",
    source: { label: "ynet", url: "https://www.ynetnews.com/article/hkcdotohjx" },
    mourning: true,
    phone: true,
  },
  {
    date: "2024-10-07",
    text: "שנה. המדינה עוצרת לזכור",
    source: { label: "ויקיפדיה", url: "https://en.wikipedia.org/wiki/October_7_attacks" },
    photo: commons(
      "one-year.webp",
      "Chenspec",
      "CC BY-SA 4.0",
      "4.0",
      "Hourglass_of_Everything_at_Hatufim_Square_Tel_Aviv,_January_2025_09.jpg",
    ),
    phone: true,
  },
  {
    date: "2025-01-19",
    text: "הפסקת אש: רומי, אמילי ודורון בבית",
    source: { label: "Yahoo News", url: "https://www.yahoo.com/news/first-three-israeli-hostages-freed-155438324.html" },
    photo: commons("ceasefire.webp", "שלמה רודד", "CC BY 2.5", "2.5", "124589_tel_aviv_-_kidnapped_square_PikiWiki_Israel.jpg"),
    phone: true,
  },
  {
    date: "2025-01-25",
    text: "התצפיתניות חוזרות אחרי 477 ימים",
    source: { label: "The Washington Post", url: "https://www.washingtonpost.com/world/2025/01/25/israel-gaza-war-hostages-released/" },
    photo: commons("observers.webp", "Oren Rozen", "CC BY-SA 4.0", "4.0", "Hostages_Square_300125_09.jpg"),
  },
  {
    date: "2025-02-01",
    text: "ירדן ביבס חוזר",
    source: {
      label: "JTA",
      url: "https://www.jta.org/2025/02/26/israel/im-sorry-i-couldnt-protect-you-all-yarden-bibas-tells-his-sons-and-wife-at-their-funeral",
    },
  },
  {
    date: "2025-02-26",
    text: "המדינה נפרדת משירי, אריאל וכפיר",
    source: {
      label: "The Times of Israel",
      url: "https://www.timesofisrael.com/shiri-ariel-and-kfir-bibas-buried-in-a-single-casket-they-will-remain-together/",
    },
    photo: commons("bibas.webp", "MathKnight", "CC BY-SA 4.0", "4.0", "Bibas-Funeral-0005.jpg"),
    phone: true,
  },
  {
    date: "2025-10-13",
    text: "כל עשרים החטופים החיים בבית",
    source: {
      label: "The Times of Israel",
      url: "https://www.timesofisrael.com/the-living-hostages-expected-to-be-released-from-gaza-under-the-ceasefire-deal/",
    },
    photo: commons("all-living.webp", "Nizzan Cohen", "CC BY 4.0", "4.0", "Hostages_Square,_13_October_2025_11.jpg"),
    phone: true,
  },
  {
    date: "2026-01-26",
    text: "רני גבילי, האחרון מ־251, חזר לישראל",
    source: { label: "The Washington Post", url: "https://www.washingtonpost.com/world/2026/01/26/israel-gaza-hostage-return/" },
    photo: commons(
      "gvili.webp",
      "ליזי שאנן",
      "CC BY 2.5",
      "2.5",
      "142958_kidnapped_square_-_waiting_for_the_return_of_the_l_PikiWiki_Israel.jpg",
    ),
    phone: true,
  },
  {
    date: "2026-02-10",
    when: "חורף 2026",
    text: "החורף השלישי: הכלניות פורחות שוב בנגב המערבי",
    source: { label: "ויקישיתוף", url: "https://commons.wikimedia.org/wiki/File:143733_shkodah_fields-south_adom_PikiWiki_Israel.jpg" },
    photo: commons("anemones.webp", "שלמה רודד", "CC BY 2.5", "2.5", "143733_shkodah_fields-south_adom_PikiWiki_Israel.jpg"),
  },
  {
    date: "2026-06-01",
    when: "2026",
    text: "כפר עזה נבנית מחדש",
    source: { label: "ynet", url: "https://www.ynetnews.com/real-estate/article/h1memx4s11g" },
  },
  {
    date: "2026-07-01",
    when: "יולי 2026",
    text: "5,000 תושבים חדשים בעוטף",
    source: {
      label: "The Times of Israel",
      url: "https://www.timesofisrael.com/gaza-border-communities-attract-5000-new-residents-amid-post-oct-7-rehabilitation/",
    },
    photo: commons("new-residents.webp", "Shulamit Zimmerman", "CC BY-SA 4.0", "4.0", "Zikim_yard_and_houses_day.jpg"),
  },
  {
    date: "2026-09-01",
    when: "ספטמבר 2026",
    text: "יותר מ־90% מתושבי העוטף חזרו הביתה",
    source: {
      label: "The Times of Israel",
      url: "https://www.timesofisrael.com/over-2500-israelis-have-moved-to-gaza-border-area-towns-in-wake-of-oct-7-report/",
    },
    photo: commons("returned.webp", "שלמה רודד", "CC BY 2.5", "2.5", "121234_kibbutz_bari_-_planting_grass_PikiWiki_Israel.jpg"),
    phone: true,
  },
]
