import type { Attention, Item, PlaceView, Report, Suppression } from "./api"
import type { OpsSummary } from "../../../worker/lib/ops-schema"
import grove from "../../../public/landscapes/beeri-forest-anemone-view.webp"
import field from "../../../public/landscapes/darom-adom-anemone-field.webp"
import acacia from "../../../public/landscapes/besor-sunset-acacia.webp"

/**
 * The prototype's server: the Worker's admin routes answered from memory, with the same paths, bodies, status codes
 * and refusal codes, so the page above it runs unchanged against the real Worker later. Every record is synthetic.
 * A scenario turns on the states a moderator rarely sees on purpose: a slow line, no line, someone else deciding first.
 */
export type Scenario = "normal" | "slow" | "offline" | "conflict" | "empty"
let scenario: Scenario = "normal"
export const setScenario = (s: Scenario) => void (scenario = s)
export const getScenario = () => scenario

const DAY = 86_400_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d+Z$/, "Z")
const H = 3_600_000

function seed() {
  const proposals: Item[] = [
    {
      id: "p_demo_hatzavim",
      rev: 1,
      revisionId: "r1",
      created_at: ago(17 * DAY),
      kind: "grove",
      name_he: "שביל החצבים",
      lat: 31.4512,
      lng: 34.5203,
      location_precision: "approximate",
      link_url: null,
      correction: 0,
      hidden: 0,
      photo_url: null,
      photo_alt: null,
      photo_credit: null,
      place_he: "יער שוקדה",
      in_memory_of: null,
      story_he: null,
      on_private_property: 0,
      location_permission: 0,
      access_note_he: null,
    },
    {
      id: "p_demo_hadekel",
      rev: 1,
      revisionId: "r2",
      created_at: ago(DAY + 3 * H),
      kind: "garden",
      name_he: "גינת הזיכרון ברחוב הדקל",
      lat: 31.5242,
      lng: 34.5961,
      location_precision: "exact",
      link_url: "https://example.org/garden-hadekel",
      correction: 0,
      hidden: 0,
      photo_url: grove,
      photo_alt: "כלניות בין העצים",
      photo_credit: "השולח",
      place_he: "שדרות",
      in_memory_of: "עומר, איתי ודניאל",
      story_he:
        "גינה קטנה שהשכנים נטעו לזכר שלושה חברים מהשכונה. כל שישי מישהו משקה, ובחורף צומחות בה כלניות.\nבכניסה יש ספסל עם השמות, ותמיד יש פרחים טריים.",
      on_private_property: 1,
      location_permission: 1,
      access_note_he: "דרך השער האחורי של בית הספר, בתיאום עם המזכירות.",
    },
    {
      id: "p_demo_noa",
      rev: 3,
      revisionId: "r3",
      created_at: ago(5 * H),
      kind: "bench",
      name_he: "ספסל לזכר נועה",
      lat: 31.6114,
      lng: 34.5108,
      location_precision: "exact",
      link_url: null,
      correction: 1,
      hidden: 0,
      photo_url: acacia,
      photo_alt: "שקיעה ושיטה בנחל הבשור",
      photo_credit: "משפחת לוי",
      place_he: "חוף זיקים",
      in_memory_of: "נועה",
      story_he: "ספסל מול הים שהמשפחה הציבה. התיקון: הוספנו את שם הצלם ותיקנו את מיקום הספסל בכמה מטרים.",
      on_private_property: 0,
      location_permission: 0,
      access_note_he: null,
    },
    {
      id: "p_demo_kibbutz",
      rev: 1,
      revisionId: "r4",
      created_at: ago(3 * H),
      kind: "lookout",
      name_he: "פינת תצפית בכניסה לקיבוץ",
      lat: 31.3842,
      lng: 34.4123,
      location_precision: "exact",
      link_url: null,
      correction: 1,
      hidden: 1,
      photo_url: field,
      photo_alt: "שדה כלניות בדרום אדום",
      photo_credit: "בני הנוער של הקיבוץ",
      place_he: "עוטף עזה",
      in_memory_of: null,
      story_he: "פינה עם עצי זית ושלט קטן, שבני הנוער בנו. מכאן רואים את כל השדות עד הגדר.",
      on_private_property: 0,
      location_permission: 0,
      access_note_he: null,
    },
    {
      id: "p_demo_shelter",
      rev: 1,
      revisionId: "r5",
      created_at: ago(40 * 60_000),
      kind: "shelter",
      name_he: "המיגונית בצומת גמה",
      lat: 31.4011,
      lng: 34.5527,
      location_precision: "exact",
      link_url: "https://example.org/shelter-gama",
      correction: 0,
      hidden: 0,
      photo_url: null,
      photo_alt: null,
      photo_credit: null,
      place_he: "צומת גמה",
      in_memory_of: "אלה שהסתתרו בה",
      story_he: "מיגונית בטון בצד הדרך. היום יש עליה ציורים של ילדים מהאזור ופרחים שמתחלפים כל שבוע.",
      on_private_property: 0,
      location_permission: 0,
      access_note_he: null,
    },
  ]
  const reports: Report[] = [
    {
      id: "r_demo_family",
      place_id: "p_demo_flowers",
      origin: "contribution",
      elements: JSON.stringify(["name_he", "story_he"]),
      requester_type: "family",
      relationship: "אח",
      explanation: "שמו של אחי מופיע כאן בלי שהמשפחה ביקשה. בבקשה להסיר עד שנדבר.",
      has_contact: 1,
      outcome: "hidden_for_review",
      status: "open",
      received_at: ago(2 * H),
      handling_note: null,
      place_name: "גן הנופלים בשכונת הפרחים",
    },
    {
      id: "r_demo_photo",
      place_id: "p_demo_olives",
      origin: "contribution",
      elements: JSON.stringify(["photo"]),
      requester_type: "rights_holder",
      relationship: null,
      explanation: "התמונה צולמה על ידי ולא נתתי רשות לפרסם אותה.",
      has_contact: 1,
      outcome: "hidden_for_review",
      status: "in_review",
      received_at: ago(DAY + 6 * H),
      handling_note: "ביקשנו מהשולח את מקור התמונה.",
      place_name: "חורשת הזיתים בניר עוז",
    },
    {
      id: "r_demo_nova",
      place_id: "nova-memorial-reim",
      origin: "curated",
      elements: JSON.stringify(["story_he"]),
      requester_type: "other",
      relationship: null,
      explanation: "יש טעות בשנת ההקמה שמופיעה בסיפור.",
      has_contact: 0,
      outcome: "received",
      status: "open",
      received_at: ago(4 * H),
      handling_note: null,
      place_name: "אתר ההנצחה לנרצחי פסטיבל נובה",
    },
  ]
  const older: Report[] = [
    {
      id: "r_demo_old",
      place_id: "p_demo_old",
      origin: "contribution",
      elements: JSON.stringify(["in_memory_of"]),
      requester_type: "family",
      relationship: "בת",
      explanation: null,
      has_contact: 0,
      outcome: "received",
      status: "closed",
      received_at: ago(9 * DAY),
      handling_note: "ההקדשה תוקנה לפי בקשת המשפחה.",
      place_name: "ספסל בכיכר המושב",
    },
  ]
  const places: Record<string, PlaceView> = {
    p_demo_flowers: {
      id: "p_demo_flowers",
      status: "published",
      rev: 4,
      suppressions: [
        { id: "s1", field: "name_he", kind: "precautionary", report_id: "r_demo_family", created_at: ago(2 * H), reason: null },
        { id: "s2", field: "story_he", kind: "precautionary", report_id: "r_demo_family", created_at: ago(2 * H), reason: null },
      ],
    },
    p_demo_olives: {
      id: "p_demo_olives",
      status: "published",
      rev: 2,
      suppressions: [
        { id: "s3", field: "photo", kind: "precautionary", report_id: "r_demo_photo", created_at: ago(DAY + 6 * H), reason: null },
      ],
    },
    p_demo_old: { id: "p_demo_old", status: "published", rev: 6, suppressions: [] },
  }
  const attention: Attention[] = [
    { id: "op1", place_id: "p_demo_olives", kind: "suppress", problem: "purge_abandoned" },
    { id: "op2", place_id: "p_demo_market", kind: "suppress", problem: "interrupted" },
  ]
  const moreAttention: Attention[] = [{ id: "op3", place_id: "p_demo_pines", kind: "media", problem: "media_failed" }]
  const contacts: Record<string, string> = { r_demo_family: "family@example.test", r_demo_photo: "photographer@example.test" }
  return { proposals, reports, older, places, attention, moreAttention, contacts, imported: new Set<string>(), ids: 10 }
}
let db = seed()
export const resetMock = () => void (db = seed())

const summary = (): OpsSummary => ({
  generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  places: { pending: db.proposals.length, returned: 2, published: 94, hidden: 1, rejected: 3, withdrawn: 1, erased: 0 },
  queue: {
    pending: db.proposals.length,
    overdue: db.proposals.filter((p) => Date.now() - Date.parse(p.created_at) > 14 * DAY).length,
    overdue_days: 14,
  },
  reports: {
    open: db.reports.filter((r) => r.status === "open").length,
    in_review: db.reports.filter((r) => r.status === "in_review").length,
    closed: 4,
  },
  attention: { interrupted: 1, ledger_repair: 0, media_failed: 1, purge_abandoned: 1 },
  retention: { last: { started_at: ago(5 * H), finished_at: ago(5 * H - 40_000), ok: true, counts: { purged: 2 } }, unfinished: 0 },
  export: { created_at: ago(9 * H), ok: true },
  drill: { started_at: ago(3 * DAY), ok: true, failure: null },
  deletion_check: { ok: 12 },
  alerts: [],
  mail_delivery: { due: 1, retry: 0, sending: 0, accepted: 31, uncertain: 1, stopped: 0 },
  mail_budget: { day: new Date().toISOString().slice(0, 10), public: 7, ops: 1, public_limit: 200, ops_limit: 20 },
  errors: {
    status: "ok",
    window_hours: 24,
    requests: 4180,
    by_code: { not_found: 9, turnstile_failed: 3 },
    per_thousand: { not_found: 2.2 },
    sample_every: 10,
    measurement: "sampled",
  },
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const refuse = (code: string, status = 400) => json({ type: "about:blank", status, code }, status)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function mockFetch(url: string, init: RequestInit = {}): Promise<Response> {
  await wait(scenario === "slow" ? 2200 : 260 + Math.random() * 220)
  if (scenario === "offline") throw new TypeError("Failed to fetch")
  const { pathname, searchParams } = new URL(url, "http://mock")
  const method = (init.method ?? "GET").toUpperCase()
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {}
  const path = pathname.replace(/^\/api\/admin/, "")
  const m = (re: RegExp) => re.exec(path)
  const empty = scenario === "empty"
  let hit: RegExpExecArray | null

  if (method === "GET" && path === "/queue") return json({ items: empty ? [] : db.proposals })
  if (method === "GET" && path === "/reports")
    return searchParams.get("cursor")
      ? json({ items: db.older, next: null })
      : json({ items: empty ? [] : db.reports, next: empty ? null : "older" })
  if (method === "GET" && path === "/attention")
    return searchParams.get("cursor")
      ? json({ ops: db.moreAttention, next: null })
      : json({ ops: empty ? [] : db.attention, next: empty ? null : "more" })
  if (method === "GET" && path === "/summary") return json(summary())

  if (method === "POST" && (hit = m(/^\/places\/([^/]+)\/transitions$/))) {
    if (scenario === "conflict") return refuse("changed_meanwhile", 409)
    const item = db.proposals.find((p) => p.id === hit![1])
    if (!item || item.rev !== body.expectedRev) return refuse("changed_meanwhile", 409)
    if (body.action === "return" && !String(body.note ?? "").trim()) return refuse("invalid_input")
    db.proposals = db.proposals.filter((p) => p !== item)
    return json({ ok: true })
  }
  if (method === "GET" && (hit = m(/^\/places\/([^/]+)$/))) {
    const place = db.places[decodeURIComponent(hit[1])]
    if (place) return json(place)
    // A place by its share link in the lookup: any demo-shaped id answers, so the tool can be tried with a made-up one.
    const id = decodeURIComponent(hit[1])
    if (/^(p_|demo)/.test(id) && !db.imported.has(id)) return json((db.places[id] = { id, status: "published", rev: 1, suppressions: [] }))
    return db.imported.has(id) ? json({ id, status: "published", rev: 1, suppressions: [] }) : refuse("not_found", 404)
  }
  if (method === "POST" && (hit = m(/^\/places\/([^/]+)\/erase$/))) {
    const place = db.places[hit[1]]
    if (!place || place.rev !== body.expectedRev) return refuse("changed_meanwhile", 409)
    if (body.confirm !== true) return refuse("invalid_input")
    place.status = "erased"
    place.suppressions = []
    place.rev++
    return json({ ok: true })
  }
  if (method === "POST" && path === "/suppressions") {
    const place = db.places[String(body.placeId)]
    if (!place || place.rev !== body.expectedRev) return refuse("changed_meanwhile", 409)
    const fields = body.fields as Suppression["field"][]
    if (!fields?.length || !String(body.reason ?? "").trim()) return refuse("invalid_input")
    for (const field of fields)
      if (!place.suppressions.some((s) => s.field === field))
        place.suppressions.push({
          id: `s${db.ids++}`,
          field,
          kind: "manual",
          report_id: (body.reportId as string) ?? null,
          created_at: ago(0),
          reason: String(body.reason),
        })
    place.rev++
    return json({ ok: true })
  }
  if (method === "POST" && (hit = m(/^\/suppressions\/([^/]+)\/lift$/))) {
    const place = Object.values(db.places).find((p) => p.suppressions.some((s) => s.id === hit![1]))
    const sup = place?.suppressions.find((s) => s.id === hit![1])
    if (!place || !sup || place.rev !== body.expectedRev) return refuse("changed_meanwhile", 409)
    const confirm = body.confirm as { affirmativeBasis?: boolean; notNonresponseOrDispute?: boolean }
    if (!confirm?.affirmativeBasis || !confirm?.notNonresponseOrDispute) return refuse("basis_confirmation_required")
    if (!String(body.basisNote ?? "").trim()) return refuse("note_required")
    if (body.basisCode === "rights_cleared" && !body.evidenceRef) return refuse("evidence_required")
    if (body.basisCode === "legal_advice" && !(body.adviserName && body.adviceDate)) return refuse("adviser_required")
    if ((body.basisCode === "requester_withdrew" || body.basisCode === "family_requested_restore") && !body.verificationNote)
      return refuse("verification_required")
    if (body.basisCode === "content_corrected" && !body.materialAbsent) return refuse("correction_required")
    const family = db.reports.find((r) => r.id === sup.report_id)?.requester_type === "family"
    if (family && !body.familyContact) return refuse("family_contact_required")
    place.suppressions = place.suppressions.filter((s) => s !== sup)
    place.rev++
    return json({ ok: true })
  }
  if (method === "GET" && (hit = m(/^\/reports\/([^/]+)\/contact$/))) {
    const email = db.contacts[hit[1]]
    return email ? json({ email }) : refuse("not_found", 404)
  }
  if (method === "POST" && (hit = m(/^\/reports\/([^/]+)\/(handle|close|reopen|purge)$/))) {
    const report = [...db.reports, ...db.older].find((r) => r.id === hit![1])
    if (!report) return refuse("not_found", 404)
    const verb = hit[2]
    if (verb === "purge") {
      Object.assign(report, { explanation: null, relationship: null, has_contact: 0, status: "closed" })
      delete db.contacts[report.id]
      return json({ ok: true })
    }
    if (verb !== "reopen" && !String(body.note ?? "").trim()) return refuse("note_required")
    if (verb === "handle") Object.assign(report, { status: "in_review", handling_note: String(body.note) })
    if (verb === "close") Object.assign(report, { status: "closed", handling_note: String(body.note) })
    if (verb === "reopen") report.status = "open"
    return json({ ok: true })
  }
  if (method === "POST" && path === "/curated-photos") return json({ key: `curated/${db.ids++}.webp` }, 201)
  if (method === "POST" && path === "/places") {
    const id = String(body.id)
    if (db.imported.has(id)) return refuse("changed_meanwhile", 409)
    db.imported.add(id)
    return json({ id }, 201)
  }
  return refuse("not_found", 404)
}
