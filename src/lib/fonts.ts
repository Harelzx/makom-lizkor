// Font files the map draws its labels with, so the map speaks in the same voice as the page.
// Swapping the site's typeface means changing these imports and the @theme fonts in index.css.
import heRegular from "@fontsource/heebo/files/heebo-hebrew-500-normal.woff2?url"
import heBold from "@fontsource/heebo/files/heebo-hebrew-700-normal.woff2?url"
import latRegular from "@fontsource/heebo/files/heebo-latin-500-normal.woff2?url"
import latBold from "@fontsource/heebo/files/heebo-latin-700-normal.woff2?url"

// The Arabic block points at the Hebrew file too: OSM names carry stray bidi marks from it, and the map shows Hebrew names only.
const HEBREW = ["U+0590-05FF", "U+0600-06FF", "U+2000-206F", "U+20AA", "U+25CC", "U+FB1D-FB4F", "U+FE00-FEFF"]

export const MAP_FONT_FILES = {
  regular: [
    { url: heRegular, "unicode-range": HEBREW },
    { url: latRegular, "unicode-range": ["U+0000-00FF"] },
  ],
  bold: [
    { url: heBold, "unicode-range": HEBREW },
    { url: latBold, "unicode-range": ["U+0000-00FF"] },
  ],
}
export const FONT_CREDIT = "Heebo של Oded Ezer ו־Meir Sadan"
