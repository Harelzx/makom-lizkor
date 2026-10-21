import type { Element } from "@/shared/contract"
import type { Kind } from "@/types"
import type { BASIS_LABEL, REQUESTER_LABEL } from "@/data/reports"
import { OpsSummary } from "../../worker/lib/ops-schema"
import { SiteHealth } from "../../worker/lib/health-schema"

/**
 * Everything the moderators' page asks of the server, in one place. The calls, paths and bodies are the ones the
 * Worker already serves (worker/routes/admin.ts); nothing here adds a route or a permission. The browser sends its
 * own Sec-Fetch-Site and the Access cookie with each call, as the Worker's write guard expects.
 */
export const request = (url: string, init?: RequestInit) => fetch(url, init)

export interface Item {
  id: string
  rev: number
  revisionId: string
  /** When it was sent: the queue is read oldest first. */
  created_at: string
  kind: Kind
  name_he: string
  lat: number
  lng: number
  location_precision: "exact" | "approximate"
  link_url: string | null
  /** 1 when this is a correction of a place that is already published (the published version stays live meanwhile). */
  correction: number
  /** 1 when that place is hidden now: approving the correction doesn't show it again. */
  hidden: number
  photo_url: string | null
  photo_alt: string | null
  photo_credit: string | null
  place_he: string | null
  in_memory_of: string | null
  story_he: string | null
  on_private_property: number
  location_permission: number
  access_note_he: string | null
}

export interface Report {
  id: string
  place_id: string
  origin: "contribution" | "curated"
  elements: string
  requester_type: keyof typeof REQUESTER_LABEL
  relationship: string | null
  explanation: string | null
  has_contact: number
  outcome: "hidden_for_review" | "received"
  status: "open" | "in_review" | "closed"
  received_at: string
  handling_note: string | null
  place_name: string | null
}
export interface Suppression {
  id: string
  field: Element
  kind: "precautionary" | "manual"
  report_id: string | null
  created_at: string
  reason: string | null
}
export interface PlaceView {
  id: string
  status: string
  rev: number
  suppressions: Suppression[]
}
export interface Attention {
  id: string
  place_id: string
  kind: string
  problem: "interrupted" | "ledger_repair" | "media_failed" | "purge_abandoned"
}
export type Basis = keyof typeof BASIS_LABEL
export type Action = "approve" | "reject" | "return"
export type Page<T> = { items: T[]; next: string | null }

const SIGN_IN = "פג תוקף הכניסה. רעננו את העמוד כדי להתחבר שוב."
const NOT_ALLOWED = "לחשבון הזה אין הרשאת ניהול."
const NO_ANSWER = "האתר לא ענה. נסו שוב בעוד רגע."
const OFFLINE = "אין חיבור לאתר. בדקו את החיבור לאינטרנט."
const NOT_SAVED = "הפעולה לא נשמרה. נסו שוב."

/** The pending submissions, or the Hebrew reason they can't be shown. */
export async function fetchQueue(): Promise<Item[] | string> {
  try {
    const res = await request("/api/admin/queue")
    if (!res.ok) return res.status === 401 ? SIGN_IN : res.status === 403 ? NOT_ALLOWED : NO_ANSWER
    return ((await res.json()) as { items: Item[] }).items
  } catch {
    return OFFLINE
  }
}

/** One page of a list, or the Hebrew reason it couldn't be read. */
export async function fetchPage<T>(path: string, key: "items" | "ops", cursor: string | null): Promise<Page<T> | string> {
  try {
    const res = await request(cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path)
    if (!res.ok) return res.status === 401 ? SIGN_IN : res.status === 403 ? NOT_ALLOWED : NO_ANSWER
    const body = (await res.json()) as Record<string, unknown> & { next: string | null }
    return { items: body[key] as T[], next: body.next }
  } catch {
    return OFFLINE
  }
}

/** A decision on a submission: "" when saved, otherwise what to tell the moderator. */
export async function transition(item: Item, action: Action, note?: string): Promise<string> {
  try {
    const res = await request(`/api/admin/places/${item.id}/transitions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(note ? { note } : {}) }),
    })
    if (res.ok) return ""
    if (res.status === 409) return "ההצעה כבר טופלה או השתנתה בינתיים. הרשימה עודכנה."
    const { code } = (await res.json().catch(() => ({}))) as { code?: string }
    return REFUSAL[code ?? ""] ?? NOT_SAVED
  } catch {
    return `${OFFLINE} הפעולה לא נשמרה.`
  }
}

const REFUSAL: Record<string, string> = {
  changed_meanwhile: "המקום השתנה בינתיים. רעננו את העמוד ונסו שוב.",
  ledger_unavailable: "רישום הפעולות לא זמין כרגע, ולכן הפעולה לא בוצעה. נסו שוב בעוד דקה.",
  media_unavailable: "שמירת התמונה נכשלה, ולכן המקום לא פורסם. נסו שוב בעוד דקה.",
  basis_confirmation_required: "צריך לסמן את שתי תיבות האישור בתחתית הטופס.",
  evidence_required: "כשהזכויות הוסדרו, צריך לכתוב איפה האישור על הזכויות.",
  adviser_required: "כשעורך דין אישר, צריך את שמו ואת תאריך הייעוץ.",
  verification_required: "צריך לכתוב איך וידאתם שזה באמת המבקש.",
  correction_required: "אפשר להחזיר מסיבה זו רק אחרי שפורסמה גרסה מתוקנת, ואחרי שסימנתם שמה שביקשו להסיר לא מופיע בה.",
  family_contact_required: "ההסתרה הייתה בבקשת המשפחה: צריך לכתוב עם מי מהמשפחה (או ממי שהקים את האנדרטה) דיברתם, ומתי.",
  note_required: "צריך לכתוב מה עשיתם.",
}

/** A write on a request or a place: "" when saved, otherwise the server's refusal in Hebrew. */
export async function send(url: string, body: unknown): Promise<string> {
  try {
    const res = await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    if (res.ok) return ""
    const { code } = (await res.json().catch(() => ({}))) as { code?: string }
    return REFUSAL[code ?? ""] ?? NOT_SAVED
  } catch {
    return `${OFFLINE} הפעולה לא נשמרה.`
  }
}

/** A place as a moderator decides on it, or why it couldn't be read. */
export async function fetchPlace(id: string): Promise<PlaceView | "missing" | "failed"> {
  const res = await request(`/api/admin/places/${encodeURIComponent(id)}`).catch(() => null)
  if (res?.status === 404) return "missing"
  return res?.ok ? ((await res.json()) as PlaceView) : "failed"
}

/** The requester's address, read on purpose (the server records each reading). */
export async function fetchContact(reportId: string): Promise<string | null> {
  const res = await request(`/api/admin/reports/${reportId}/contact`).catch(() => null)
  return res?.ok ? ((await res.json()) as { email: string }).email : null
}

/** The operations counts: aggregates only, no contacts or contents. */
export async function fetchSummary(): Promise<OpsSummary | null> {
  try {
    const res = await request("/api/admin/summary", { cache: "no-store", signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return OpsSummary.parse(await res.json())
  } catch {
    return null
  }
}
export async function fetchHealth(): Promise<SiteHealth | null> {
  try {
    const res = await request("/api/admin/health", { cache: "no-store", signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return SiteHealth.parse(await res.json())
  } catch {
    return null
  }
}
export type { OpsSummary }
