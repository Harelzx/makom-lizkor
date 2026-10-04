import type { Kind } from "@/types"

export const KINDS: Record<Kind, { label: string; plural: string }> = {
  community: { label: "קהילה", plural: "קהילות" },
  monument: { label: "אנדרטה", plural: "אנדרטאות" },
  bench: { label: "ספסל", plural: "ספסלים" },
  lookout: { label: "מצפור", plural: "מצפורים" },
  grove: { label: "חורשה", plural: "חורשות" },
  garden: { label: "גן זיכרון", plural: "גני זיכרון" },
  plaque: { label: "לוח זיכרון", plural: "לוחות זיכרון" },
  shelter: { label: "מיגונית", plural: "מיגוניות" },
  site: { label: "אתר זיכרון", plural: "אתרי זיכרון" },
  museum: { label: "מרכז מורשת", plural: "מרכזי מורשת" },
  other: { label: "מחווה", plural: "מחוות" },
}

export const ADDABLE_KINDS: Kind[] = ["bench", "lookout", "grove", "garden", "plaque", "monument", "other"]

/** "2026-08-31" or "2026-08" → "אוגוסט 2026"; anything else is shown as written. */
export function formatMonth(date?: string | null) {
  if (!date) return ""
  const m = /^(\d{4})-(\d{2})/.exec(date)
  if (!m) return date
  return new Date(+m[1], +m[2] - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" })
}

export const RETURN_LABEL: Record<"full" | "partial" | "not-yet" | "unknown", string> = {
  full: "חזרו הביתה",
  partial: "החזרה בעיצומה",
  "not-yet": "בדרך הביתה",
  unknown: "אין מידע עדכני",
}
