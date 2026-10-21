import type { Element } from "@/shared/contract"

/** What a request can name, as the form and the moderators' queue say it. */
export const ELEMENT_LABEL: Record<Element, string> = {
  name_he: "השם",
  in_memory_of: "ההקדשה (לזכר)",
  story_he: "הסיפור",
  photo: "התמונה",
  whole: "המקום כולו",
}

export const REQUESTER_LABEL = {
  family: "בן או בת משפחה",
  rights_holder: "בעלי הזכויות בתמונה",
  other: "אחר (טעות, תוכן פוגע)",
} as const

/** The restoration codes of spec 6, as a moderator chooses among them (the moderators' page only). */
export const BASIS_LABEL = {
  requester_withdrew: "המבקש חזר בו מהבקשה",
  family_requested_restore: "המבקש או המשפחה ביקשו להחזיר",
  rights_cleared: "הזכויות בתמונה הוסדרו",
  content_corrected: "התוכן תוקן בגרסה חדשה שנבדקה",
  hidden_in_error: "הוסתר בטעות (ספאם, בקשה שגויה, טעות בסיווג)",
  review_supports_restore: "בדקנו, ואין סיבה להמשיך להסתיר",
  legal_advice: "עורך דין אישר להחזיר",
} as const

/** The button that lets a kept request go; the report notice names it, word for word (notice.test.ts checks). */
export const DISCARD_LABEL = "הסרה מהמכשיר הזה"
