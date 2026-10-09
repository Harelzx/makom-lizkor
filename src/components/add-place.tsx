import { useCallback, useEffect, useId, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { CrosshairIcon, DownloadIcon, ImagePlusIcon, Loader2Icon, LocateFixedIcon, MapPinIcon, UploadIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Anemone } from "@/components/anemone"
import { ADDABLE_KINDS, KINDS } from "@/data/taxonomy"
import { CONSENT_TEXT, FAMILY_CONSENT_TEXT, noticeHtml, PHOTO_RIGHTS_TEXT } from "@/data/legal"
import { useVisibleViewport } from "@/lib/use-visible-viewport"
import { SubmissionResult, type SubmissionOutcome } from "@/components/submission-result"
import { FormFlower } from "@/components/form-flower"
import { requestCurrentLocation, type LocationUpdate } from "@/lib/current-location"
import { newSubmitKey, submitPlace, uploadPhoto } from "@/lib/api"
import { exportable } from "@/lib/export"
import { downloadJSON, resizeImage } from "@/lib/storage"
import { getMap, reducedMotion } from "@/map/controller"
import { useStore } from "@/store"
import { ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { CURRENT_SUBMISSION_NOTICE, type SubmissionInput } from "@/shared/contract"
import type { Kind, Place } from "@/types"

type Step = 0 | 1 | 2

const QUEUE_FULL = "אנחנו מקבלים עכשיו יותר הצעות ממה שאפשר לבדוק. ההצעה לא נשמרה במכשיר ולא תישלח שוב ברקע."
const CHECK_FAILED = "בדיקת הדפדפן לא הצליחה. ההצעה לא נשמרה במכשיר ולא תישלח שוב ברקע."

// The form sends the place for review, so it shows the notice for submissions: the same version each submission records.
const NOTICE_HTML = noticeHtml(CURRENT_SUBMISSION_NOTICE)

/** People type "www.site.co.il" or paste a full address; either way we store a working https link. */
const stripScheme = (v: string) =>
  v
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/+/, "")
const looksLikeAddress = (v: string) => /^[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/.test(v)
const STEPS = ["איפה", "מה", "אישור"]
const TITLES = ["איפה המקום?", "מה יש שם?", "לפני שמוסיפים"]
const DESCRIPTIONS = [
  "ספסל, מצפור, עץ או פינה קטנה. כל מקום שהוקם לזכר מי שנרצחו או נפלו ב־7 באוקטובר מקבל כאן כלנית.",
  "כמה פרטים, כפי שהמשפחה רוצה שיופיעו.",
  "ההצעה תישלח לבדיקה ותופיע לכולם אחרי אישור. עותק למעקב יישמר אצלכם רק אחרי שהשליחה תאושר.",
]
/** And the sky behind it warms toward morning, the way the map does at the opening. */
const SKY = [
  "bg-[radial-gradient(130%_120%_at_20%_0%,var(--p-sky-100),var(--p-field-50)_55%,var(--surface)_100%)] dark:bg-[radial-gradient(130%_120%_at_20%_0%,var(--p-ink-700),var(--p-ink-800)_60%,var(--surface)_100%)]",
  "bg-[radial-gradient(130%_120%_at_20%_0%,var(--p-sun-100),var(--p-field-50)_55%,var(--surface)_100%)] dark:bg-[radial-gradient(130%_120%_at_20%_0%,var(--p-dusk),var(--p-ink-800)_60%,var(--surface)_100%)]",
  "bg-[radial-gradient(120%_130%_at_20%_10%,var(--p-sun-200),var(--p-anemone-50)_50%,var(--surface)_100%)] dark:bg-[radial-gradient(120%_130%_at_20%_10%,color-mix(in_oklab,var(--p-anemone-700)_45%,var(--p-dusk)),var(--p-ink-800)_60%,var(--surface)_100%)]",
]
/** Steps turn like pages in a Hebrew book: the next one comes in from the left, going back returns from the right. */
const turn = {
  enter: (d: number) => ({ x: d * -20, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  leave: (d: number) => ({ x: d * 20, opacity: 0 }),
}
/** Headings roll to the next line instead of being swapped in place. */
const roll = {
  enter: (d: number) => ({ y: d * 14, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  leave: (d: number) => ({ y: d * -14, opacity: 0 }),
}

export function AddPlace() {
  const open = useStore((s) => s.addOpen)
  const setOpen = useStore((s) => s.setAddOpen)
  const lessMotion = useReducedMotion()
  const picking = useStore((s) => s.picking)
  const visibleViewport = useVisibleViewport(open && !picking)
  const setPicking = useStore((s) => s.setPicking)
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const addLocal = useStore((s) => s.addLocal)
  const updateLocal = useStore((s) => s.updateLocal)
  const select = useStore((s) => s.select)
  const local = useStore((s) => s.local)
  const importLocal = useStore((s) => s.importLocal)

  const [locationStatus, setLocationStatus] = useState<LocationUpdate | null>(null)
  const locationRequest = useRef<(() => void) | null>(null)
  const stopLocating = useCallback(() => {
    locationRequest.current?.()
    locationRequest.current = null
    setLocationStatus(null)
  }, [])
  const [step, setStepRaw] = useState<Step>(0)
  // which way the steps slide: forward comes in from the reading direction, back returns the other way
  const [dir, setDir] = useState(1)
  const setStep = (next: Step | ((s: Step) => Step)) => {
    stopLocating()
    setStepRaw((cur) => {
      const n = typeof next === "function" ? next(cur) : next
      setDir(n >= cur ? 1 : -1)
      return n
    })
  }
  // a failed "next" shakes the button, so the eye goes to the message
  const [shake, setShake] = useState(0)
  const [kind, setKind] = useState<Kind>("bench")
  const [name, setName] = useState("")
  const [placeHe, setPlaceHe] = useState("")
  const [inMemoryOf, setInMemoryOf] = useState("")
  const [story, setStory] = useState("")
  const [link, setLink] = useState("")
  const [photo, setPhoto] = useState<string>()
  const [photoAlt, setPhotoAlt] = useState("")
  const [photoCredit, setPhotoCredit] = useState("")
  const [photoRights, setPhotoRights] = useState(false)
  const [submitter, setSubmitter] = useState("")
  const [email, setEmail] = useState("")
  // A place on private property: approximate unless the owner allowed the exact point, with a note on how to visit.
  const [privateLand, setPrivateLand] = useState(false)
  const [permission, setPermission] = useState(false)
  const [accessNote, setAccessNote] = useState("")
  const [family, setFamily] = useState(false)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState("")
  const [errorField, setErrorField] = useState("")
  // A response to a closed form must never change the next proposal or a manually selected point.
  useEffect(() => () => locationRequest.current?.(), [open, picking, step])
  const [outcome, setOutcome] = useState<SubmissionOutcome | null>(null)
  const sendCount = useRef(0)
  const [sendNumber, setSendNumber] = useState(0)
  // Only RAM, never IndexedDB: an uncertain retry uses the exact original body and key.
  const attempt = useRef<{ place: Place; submission: SubmissionInput; key: string } | null>(null)
  const accepted = useRef<Place | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [saved, setSaved] = useState(false)
  // Places that never reached the server (it was down); only these still need the export.
  const unsent = local.filter((p) => !p.local?.remoteId).length
  // Set the moment saving starts, before the send: a second tap or Enter while the server answers must not send it again.
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  // stable, so the bar takes the focus once when it appears and not on every render after
  const focusOnMount = useCallback((el: HTMLDivElement | null) => el?.focus({ preventScroll: true }), [])
  // A point marked on the map answers "mark the place first"; the message goes once there is one, however it was set.
  const [seenDraft, setSeenDraft] = useState(draft)
  if (seenDraft !== draft) {
    setSeenDraft(draft)
    if (draft && error) setError("")
  }
  // The step area grows and shrinks to fit each step, instead of the dialog jumping between sizes.
  const [bodyH, setBodyH] = useState(0)
  const measureBody = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const ro = new ResizeObserver(() => setBodyH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // A new step takes focus at its heading, so keyboards start there and screen readers read where they are.
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) {
      moved.current = true
      return
    }
    // a long step may have been scrolled; the next one starts from its top, not from an empty stretch
    scrollRef.current?.scrollTo({ top: 0 })
    titleRef.current?.focus({ preventScroll: true })
  }, [step])

  const reset = useCallback(() => {
    stopLocating()
    setStepRaw(0)
    setDir(1)
    setName("")
    setPlaceHe("")
    setInMemoryOf("")
    setStory("")
    setLink("")
    setPhoto(undefined)
    setPhotoAlt("")
    setPhotoCredit("")
    setPhotoRights(false)
    setSubmitter("")
    setEmail("")
    setPrivateLand(false)
    setPermission(false)
    setAccessNote("")
    setFamily(false)
    setConsent(false)
    setError("")
    setErrorField("")
    setOutcome(null)
    sendCount.current = 0
    setSendNumber(0)
    setSaved(false)
    attempt.current = null
    accepted.current = null
  }, [stopLocating])

  const locate = () => {
    setError("")
    setErrorField("")
    locationRequest.current?.()
    locationRequest.current = requestCurrentLocation({ secure: window.isSecureContext, geolocation: navigator.geolocation }, (result) => {
      setLocationStatus(result)
      if (result.kind !== "found") return
      const p = result.point
      setDraft(p)
      setError("")
      getMap()?.flyTo({ center: [p.lng, p.lat], zoom: 17, duration: reducedMotion() ? 0 : 2000 })
    })
  }

  const fail = (msg: string, field = "") => {
    setError(msg)
    setErrorField(field)
    if (!reducedMotion()) setShake((n) => n + 1)
    requestAnimationFrame(() => {
      const el = field && document.getElementById(`${uid}-${field}`)
      if (el) {
        el.focus({ preventScroll: true })
        el.scrollIntoView({ block: "center", behavior: "instant" })
      }
    })
  }
  const errorFor = (field: string) =>
    error && errorField === field ? (
      <p id={`${uid}-${field}-error`} role="alert" className="text-caption text-destructive">
        {error}
      </p>
    ) : null
  const invalid = (field: string) => ({
    "aria-invalid": !!error && errorField === field,
    "aria-describedby": error && errorField === field ? `${uid}-${field}-error` : undefined,
  })

  const next = () => {
    if (step === 0) {
      if (!draft) return fail("סמנו קודם את המקום על המפה.", "point")
      if (draft.lat < 29.4 || draft.lat > 33.45 || draft.lng < 34.2 || draft.lng > 35.95)
        return fail("הנקודה מחוץ לאזור שהמפה מכסה. סמנו שוב.", "point")
      if (privateLand && permission && !accessNote.trim())
        return fail("כדי להציג מיקום מדויק בשטח פרטי, כתבו איך מגיעים ומתי מותר לבקר.", "access")
    }
    if (step === 1) {
      if (!name.trim()) return fail('כתבו איך נקרא המקום, למשל "הספסל של נועה".', "name")
      if (link && !looksLikeAddress(link)) return fail("הכתובת לא נראית תקינה. כתבו אותה כך: www.example.co.il", "link")
      if (photo && !photoAlt.trim()) return fail("כתבו במשפט קצר מה רואים בתמונה.", "alt")
      if (photo && !photoRights) return fail("כדי לצרף תמונה צריך לאשר שיש לכם זכות להשתמש בה.", "rights")
    }
    setError("")
    setStep((s) => (s + 1) as Step)
  }

  const save = async () => {
    if (!draft) return setStep(0)
    if (!family || !consent) return fail("כדי לשלוח צריך לסמן את שתי ההצהרות.", "family")
    if (saved || sending.current) return
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return fail("כתובת המייל לא נראית תקינה.", "email")
    sending.current = true
    setBusy(true)
    const startedAt = performance.now()
    sendCount.current += 1
    const attemptNumber = sendCount.current
    setSendNumber(attemptNumber)
    const now = new Date().toISOString()
    const approximate = privateLand && !permission
    const place: Place = {
      id: `local-${newSubmitKey()}`,
      name_he: name.trim(),
      kind,
      // Approximate on private property without permission: this device shows what will be published, not the exact pin.
      lat: approximate ? +draft.lat.toFixed(2) : +draft.lat.toFixed(6),
      lng: approximate ? +draft.lng.toFixed(2) : +draft.lng.toFixed(6),
      precision: approximate ? "approx" : "exact",
      place_he: placeHe.trim() || "נוסף על ידי משפחה או חברים",
      summary_he: story.trim(),
      accessNote: privateLand && permission ? accessNote.trim() : undefined,
      links: link ? [{ label_he: "קישור שצירפתם", url: `https://${link}` }] : [],
      coord_source: "community",
      region: draft.lat < 31.7 && draft.lng < 34.75 && draft.lat > 31.1 ? "envelope" : "country",
      local: {
        createdAt: now,
        consentAt: now,
        inMemoryOf: inMemoryOf.trim() || undefined,
        story: story.trim() || undefined,
        submitter: submitter.trim() || undefined,
        photo,
        photoAlt: photo ? photoAlt.trim() : undefined,
        photoCredit: photo ? photoCredit.trim() || undefined : undefined,
      },
    }
    // The form exists only in this tab until the server confirms acceptance. A failed send adds no local place.
    const submission: SubmissionInput = {
      kind: kind as SubmissionInput["kind"],
      name_he: place.name_he,
      lat: place.lat,
      lng: place.lng,
      place_he: placeHe.trim() || undefined,
      in_memory_of: inMemoryOf.trim() || undefined,
      story_he: story.trim() || undefined,
      link_url: link ? `https://${link}` : undefined,
      submitter_name: submitter.trim() || undefined,
      email: email.trim() || undefined,
      on_private_property: privateLand,
      location_permission: privateLand && permission,
      access_note_he: privateLand && permission ? accessNote.trim() || undefined : undefined,
      consent_version: CURRENT_SUBMISSION_NOTICE,
    }
    const current = attempt.current ?? { place, submission, key: newSubmitKey() }
    attempt.current = current
    try {
      const r = await submitPlace(current.submission, current.key)
      if (!r.ok) {
        // A definitive refusal permits editing. An unknown arrival retains the exact attempt in RAM for manual retry.
        if (r.kind === "rejected") attempt.current = null
        setOutcome({
          kind: r.kind,
          attemptNumber,
          retryAt: r.kind === "temporary" && r.retryAfter ? Date.now() + r.retryAfter * 1000 : undefined,
          description:
            r.kind === "rejected"
              ? "ההצעה לא נשמרה במכשיר ולא נוספה למפה. אפשר לחזור לטופס, לבדוק את הפרטים ולשלוח שוב. בסגירת החלון הפרטים יימחקו."
              : r.code === "queue_full"
                ? QUEUE_FULL
                : r.code === "turnstile_failed"
                  ? CHECK_FAILED
                  : r.code === "turnstile_required"
                    ? "לא הצלחנו להשלים את בדיקת הדפדפן. בדקו את החיבור ונסו שוב. ההצעה לא נשמרה במכשיר ולא תישלח ברקע. בסגירת החלון הפרטים יימחקו."
                    : "לא התקבל אישור מהשרת. ההצעה לא נשמרה במכשיר ולא נוספה למפה. אפשר לנסות שוב כאן; היא לא תישלח ברקע. אם התשובה אבדה, ייתכן שההצעה כבר הגיעה. בסגירת החלון הפרטים יימחקו.",
        })
        return
      }
      // Only a confirmed receipt creates the local tracking copy. No email or retry body is stored.
      const acceptedPlace = current.place
      Object.assign(acceptedPlace.local!, { send: "sent", remoteId: r.id, trackingToken: r.trackingToken })
      const stored = await addLocal(acceptedPlace)
      accepted.current = acceptedPlace
      attempt.current = null
      setSaved(true)
      let photoNote = ""
      const l = acceptedPlace.local!
      if (l.photo) {
        const photoResult = await uploadPhoto(r.id, r.trackingToken, l.photo, l.photoAlt || acceptedPlace.name_he, l.photoCredit)
        if (photoResult !== "temporary")
          await updateLocal(acceptedPlace.id, photoResult === "ok" ? { photoSent: true } : { photoError: "refused" })
        if (photoResult === "rejected") photoNote = " התמונה לא התקבלה; אפשר לבדוק זאת במעקב."
        if (photoResult === "temporary") photoNote = " התמונה עדיין ממתינה להעלאה; ננסה להעלות אותה בהמשך."
      }
      setOutcome({
        kind: "sent",
        attemptNumber,
        stored,
        description:
          "עזרתם לעוד אדם להכיר את המקום ואת מי שהוא מנציח. נבדוק את ההצעה לפני שתופיע לכולם." +
          (!stored
            ? " לא הצלחנו לשמור את קישור המעקב במכשיר; כדאי להעתיק אותו מהמעקב לפני סגירת הדף."
            : " אפשר לעקוב אחריה מתוך הכרטיס שלה.") +
          photoNote,
      })
      navigator.vibrate?.(12)
    } catch {
      // Don't claim failure if the place is already accepted, e.g. when the optional photo encounters an error.
      if (accepted.current)
        setOutcome({
          kind: "sent",
          attemptNumber,
          description: "ההצעה התקבלה לבדיקה. אפשר לראות את מצבה מתוך הכרטיס שלה; התמונה עשויה עדיין להמתין להעלאה.",
        })
      else
        setOutcome({
          kind: "temporary",
          attemptNumber,
          description: "לא הצלחנו לוודא שההצעה הגיעה. היא לא נשמרה במכשיר ולא תישלח ברקע. אפשר לנסות שוב כאן; בסגירת החלון הפרטים יימחקו.",
        })
    } finally {
      // A fast repeated failure still has a perceptible sending state, followed by a persistent numbered result.
      const feedbackTime = 600 - (performance.now() - startedAt)
      if (feedbackTime > 0) await new Promise((resolve) => setTimeout(resolve, feedbackTime))
      sending.current = false
      setBusy(false)
    }
  }

  const close = () => {
    if (busy) return
    const place = accepted.current
    setOpen(false)
    setDraft(null)
    reset()
    if (place) {
      useStore.getState().setTab("places")
      select(place.id)
      useStore.getState().celebrate()
    }
  }

  // Enter in a one-line field moves on, as it would in any form.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || !(e.target instanceof HTMLInputElement) || e.target.type === "checkbox") return
    e.preventDefault()
    if (step < 2) next()
    else void save()
  }

  return (
    <>
      <Dialog open={open && !picking} onOpenChange={(v) => !v && close()}>
        {outcome ? (
          <SubmissionResult
            result={outcome}
            busy={busy}
            attemptNumber={sendNumber}
            onContinue={close}
            onClose={close}
            onRetry={() => void save()}
            onEdit={() => setOutcome(null)}
          />
        ) : (
          <DialogContent
            dir="rtl"
            showCloseButton={!busy}
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
            onPointerDownOutside={(e) => busy && e.preventDefault()}
            style={{ maxHeight: visibleViewport.height * 0.92, top: visibleViewport.top + visibleViewport.height / 2 }}
            className="flex h-[min(760px,92dvh)] max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-w-[560px]"
          >
            <div data-add-art-header className="relative h-24 shrink-0 overflow-hidden rounded-t-[inherit] sm:h-32" aria-hidden="true">
              {SKY.map((sky, i) => (
                <motion.div
                  key={i}
                  className={cn("absolute inset-0", sky)}
                  initial={false}
                  animate={{ opacity: i <= step ? 1 : 0 }}
                  transition={{ duration: 0.7, ease }}
                />
              ))}
              <FormFlower step={step} />
            </div>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 [scroll-padding-block:16px] overflow-y-auto overscroll-contain [&_input]:text-base [&_textarea]:text-base"
            >
              <DialogHeader className="gap-2 px-6 pt-2">
                <div className="flex flex-col gap-2.5">
                  <ol className="grid grid-cols-3 items-center gap-1.5" aria-label={`שלב ${step + 1} מתוך 3`}>
                    {STEPS.map((label, i) => (
                      <li
                        key={label}
                        className="flex min-w-0 items-center justify-center gap-2.5 text-label font-semibold"
                        aria-current={i === step ? "step" : undefined}
                      >
                        <span
                          className={cn(
                            "relative grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-300",
                            i < step ? "bg-ink-1 text-surface" : i === step ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-3",
                          )}
                        >
                          {/* one ring travels to wherever you are */}
                          {i === step && (
                            <motion.span
                              layoutId={`${uid}-ring`}
                              className="absolute -inset-1 rounded-full ring-2 ring-brand/35"
                              transition={spring.snappy}
                            />
                          )}
                          {i < step ? (
                            <motion.svg
                              viewBox="0 0 12 12"
                              className="size-3"
                              aria-hidden="true"
                              initial={{ scale: 0.6 }}
                              animate={{ scale: 1 }}
                              transition={spring.bouncy}
                            >
                              <motion.path
                                d="M2.5 6.4 L5 8.7 L9.6 3.6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.35, ease }}
                              />
                            </motion.svg>
                          ) : (
                            <span className="text-caption tabular-nums">{i + 1}</span>
                          )}
                        </span>
                        <span className={cn("whitespace-nowrap transition-colors duration-300", i === step ? "text-ink-1" : "text-ink-3")}>
                          {label}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {/* three segments, each filling in turn as its step is reached */}
                  <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
                    {STEPS.map((label, i) => (
                      <div key={label} className="h-1 overflow-hidden rounded-full bg-surface-2">
                        <motion.div
                          className="h-full origin-right rounded-full bg-brand"
                          initial={false}
                          animate={{ scaleX: i <= step ? 1 : 0 }}
                          transition={{ ...spring.soft, delay: i <= step ? 0.08 : 0 }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <DialogTitle ref={titleRef} tabIndex={-1} className="relative text-title-2 font-extrabold text-ink-1 outline-none">
                  <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                    <motion.span
                      key={step}
                      className="block"
                      custom={dir}
                      variants={roll}
                      initial={lessMotion ? false : "enter"}
                      animate="center"
                      exit={lessMotion ? { opacity: 0, transition: { duration: 0 } } : "leave"}
                      transition={{ duration: lessMotion ? 0 : 0.22, ease }}
                    >
                      {TITLES[step]}
                    </motion.span>
                  </AnimatePresence>
                </DialogTitle>
                <DialogDescription className="relative text-pretty">
                  <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                    <motion.span
                      key={step}
                      className="block"
                      custom={dir}
                      variants={roll}
                      initial={lessMotion ? false : "enter"}
                      animate="center"
                      exit={lessMotion ? { opacity: 0, transition: { duration: 0 } } : "leave"}
                      transition={{ duration: lessMotion ? 0 : 0.22, ease, delay: lessMotion ? 0 : 0.03 }}
                    >
                      {DESCRIPTIONS[step]}
                    </motion.span>
                  </AnimatePresence>
                </DialogDescription>
                {step === 0 && <p className="mt-1 text-caption text-ink-2">בלי הרשמה. המייל לא חובה. ההצעה תתפרסם אחרי בדיקה.</p>}
              </DialogHeader>

              <fieldset disabled={busy} className="min-w-0 px-6 pt-5 pb-6" onKeyDown={onKeyDown}>
                {/* the clip has a little room on every side so focus rings are never cut */}
                <motion.div
                  className="-m-2 overflow-hidden"
                  initial={false}
                  animate={{ height: bodyH || "auto" }}
                  transition={{ type: "spring", stiffness: 380, damping: 38 }}
                >
                  <div ref={measureBody} className="relative p-2">
                    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                      <motion.div
                        key={step}
                        custom={dir}
                        variants={turn}
                        initial={lessMotion ? false : "enter"}
                        animate="center"
                        exit={lessMotion ? { opacity: 0, transition: { duration: 0 } } : "leave"}
                        transition={{ duration: lessMotion ? 0 : 0.22, ease }}
                      >
                        {step === 0 && (
                          <FieldGroup className="cascade">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Button
                                id={`${uid}-point`}
                                {...invalid("point")}
                                variant="outline"
                                className="h-14 justify-start rounded-2xl"
                                onClick={() => {
                                  stopLocating()
                                  setPicking(true)
                                }}
                              >
                                <CrosshairIcon data-icon="inline-start" />
                                סימון על המפה
                              </Button>
                              <Button
                                variant="outline"
                                className="h-14 justify-start rounded-2xl"
                                onClick={locate}
                                disabled={locationStatus?.kind === "locating"}
                                aria-busy={locationStatus?.kind === "locating"}
                                aria-describedby={locationStatus ? `${uid}-location-status` : undefined}
                              >
                                {locationStatus?.kind === "locating" ? (
                                  <Loader2Icon data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
                                ) : (
                                  <LocateFixedIcon data-icon="inline-start" />
                                )}
                                {locationStatus?.kind === "locating" ? "מאתרים מיקום…" : "המיקום הנוכחי שלי"}
                              </Button>
                            </div>
                            {locationStatus && (
                              <p
                                id={`${uid}-location-status`}
                                data-location-status
                                role={locationStatus.kind === "error" ? "alert" : "status"}
                                className={cn("text-caption", locationStatus.kind === "error" ? "text-destructive" : "text-ink-2")}
                              >
                                {locationStatus.kind === "error"
                                  ? locationStatus.message
                                  : locationStatus.kind === "locating"
                                    ? "ממתינים למיקום מהמכשיר. אם תופיע בקשת הרשאה, אפשר לאשר אותה. אפשר גם לסמן על המפה."
                                    : "המיקום נמצא וסומן על המפה. בדקו שזו הפינה שרציתם להוסיף."}
                              </p>
                            )}
                            {errorFor("point")}
                            {draft && (
                              <Alert key={`${draft.lat},${draft.lng}`} className="has-[>svg]:grid-cols-[auto_minmax(0,1fr)]">
                                <MapPinIcon className="pin-drop text-brand" />
                                <AlertDescription className="flex min-w-0 flex-col gap-2">
                                  <span className="tabular-nums">
                                    סומן מיקום{" "}
                                    <bdi dir="ltr" className="whitespace-nowrap">
                                      ({draft.lat.toFixed(5)}, {draft.lng.toFixed(5)})
                                    </bdi>
                                    . אפשר לגרור את הסיכה במפה כדי לדייק.
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="self-end"
                                    onClick={() => {
                                      stopLocating()
                                      setDraft(null)
                                    }}
                                  >
                                    <XIcon data-icon="inline-start" />
                                    הסרת הסיכה
                                  </Button>
                                </AlertDescription>
                              </Alert>
                            )}
                            <Field orientation="horizontal">
                              <Checkbox id={`${uid}-private`} checked={privateLand} onCheckedChange={(v) => setPrivateLand(v === true)} />
                              <FieldLabel htmlFor={`${uid}-private`} className="leading-snug font-normal">
                                המקום נמצא בשטח פרטי, למשל בחצר של בית
                              </FieldLabel>
                            </Field>
                            {privateLand && (
                              <FieldGroup className="gap-3 ps-7">
                                <FieldDescription>
                                  נציג אותו במיקום משוער, ברמת היישוב, בלי ניווט אליו, ונשמור רק את הנקודה המעוגלת. מיקום מדויק יוצג רק
                                  ברשות הבעלים.
                                </FieldDescription>
                                <Field orientation="horizontal">
                                  <Checkbox
                                    id={`${uid}-permission`}
                                    checked={permission}
                                    onCheckedChange={(v) => setPermission(v === true)}
                                  />
                                  <FieldLabel htmlFor={`${uid}-permission`} className="leading-snug font-normal">
                                    בעלי השטח הסכימו שנציג את המיקום המדויק
                                  </FieldLabel>
                                </Field>
                                {permission && (
                                  <Field>
                                    <FieldLabel htmlFor={`${uid}-access`}>איך מגיעים ומתי מותר לבקר</FieldLabel>
                                    <Textarea
                                      id={`${uid}-access`}
                                      {...invalid("access")}
                                      value={accessNote}
                                      onChange={(e) => setAccessNote(e.target.value)}
                                      maxLength={300}
                                    />
                                    {errorFor("access")}
                                  </Field>
                                )}
                              </FieldGroup>
                            )}
                            <details className="rounded-2xl border border-line p-4">
                              <summary className="pressable min-h-11 cursor-pointer py-2 text-label text-ink-2">
                                ההצעות שלי וייבוא / ייצוא
                              </summary>
                              <div className="mt-2 flex flex-col gap-2">
                                <p className="text-label text-ink-1">המקומות שהוספתם</p>
                                <p className="text-caption text-ink-2">
                                  {local.length === 0
                                    ? "עוד לא הוספתם מקומות מהמכשיר הזה."
                                    : unsent === 0
                                      ? `${local.length === 1 ? "המקום שהוספתם נשלח" : `כל ${local.length} המקומות שהוספתם נשלחו`} לבדיקה. עותק נשמר גם במכשיר.`
                                      : `${unsent === 1 ? "מקום אחד לא נשלח" : `${unsent} מקומות לא נשלחו`} ונשמר במכשיר בלבד. המצב מופיע בכרטיס של כל הצעה; הצעות ממתינות יישלחו שוב אוטומטית.`}
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!local.length}
                                    onClick={() => downloadJSON("makom-lizkor-places.json", exportable(local))}
                                  >
                                    <DownloadIcon data-icon="inline-start" />
                                    ייצוא
                                  </Button>
                                  <Button variant="outline" size="sm" asChild>
                                    <label className="cursor-pointer">
                                      <UploadIcon data-icon="inline-start" />
                                      ייבוא
                                      <input
                                        type="file"
                                        accept="application/json,.json"
                                        className="sr-only"
                                        onChange={async (e) => {
                                          const f = e.target.files?.[0]
                                          if (!f) return
                                          try {
                                            const data = JSON.parse(await f.text())
                                            const { added: n, saved } = await importLocal(Array.isArray(data) ? data : [])
                                            if (!n) toast("לא נמצאו בקובץ מקומות חדשים")
                                            else if (!saved)
                                              toast(`נוספו ${n} מקומות`, { description: "הם לא נשמרו במכשיר הזה, ויימחקו כשתסגרו את הדף." })
                                            else toast(`נוספו ${n} מקומות`)
                                          } catch {
                                            toast("הקובץ לא נקרא. צריך קובץ JSON שיוצא מכאן.")
                                          }
                                        }}
                                      />
                                    </label>
                                  </Button>
                                </div>
                              </div>
                            </details>
                          </FieldGroup>
                        )}

                        {step === 1 && (
                          <FieldGroup className="cascade">
                            <FieldSet>
                              <FieldLegend variant="label">סוג ההנצחה</FieldLegend>
                              <ToggleGroup
                                type="single"
                                value={kind}
                                onValueChange={(v) => v && setKind(v as Kind)}
                                className="flex flex-wrap justify-start gap-2"
                                spacing={2}
                              >
                                {ADDABLE_KINDS.map((k) => (
                                  <ToggleGroupItem
                                    key={k}
                                    value={k}
                                    variant="outline"
                                    className="pressable relative isolate rounded-full px-4 text-label data-[state=on]:border-transparent data-[state=on]:bg-transparent data-[state=on]:text-ink-1"
                                  >
                                    {/* the choice slides from chip to chip instead of blinking */}
                                    {kind === k && (
                                      <motion.span
                                        layoutId={`${uid}-kind`}
                                        className="absolute -inset-px -z-10 rounded-full bg-ink-1/[0.06] ring-[1.5px] ring-ink-1"
                                        transition={spring.snappy}
                                      />
                                    )}
                                    {KINDS[k].label}
                                  </ToggleGroupItem>
                                ))}
                              </ToggleGroup>
                            </FieldSet>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-name`}>שם המקום</FieldLabel>
                              <Input
                                id={`${uid}-name`}
                                {...invalid("name")}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                maxLength={80}
                                placeholder='למשל "מצפור עומר"'
                              />
                              {errorFor("name")}
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-mem`}>לזכר (לא חובה)</FieldLabel>
                              <Input id={`${uid}-mem`} value={inMemoryOf} onChange={(e) => setInMemoryOf(e.target.value)} maxLength={120} />
                              <FieldDescription>שם או שמות, כפי שהמשפחה רוצה שיופיעו.</FieldDescription>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-place`}>יישוב או אזור</FieldLabel>
                              <Input id={`${uid}-place`} value={placeHe} onChange={(e) => setPlaceHe(e.target.value)} maxLength={60} />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-story`}>כמה מילים על המקום (לא חובה)</FieldLabel>
                              <Textarea
                                id={`${uid}-story`}
                                value={story}
                                onChange={(e) => setStory(e.target.value)}
                                maxLength={600}
                                rows={4}
                              />
                              <FieldDescription className="tabular-nums">{story.length}/600</FieldDescription>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-link`}>קישור לאתר הנצחה (לא חובה)</FieldLabel>
                              <InputGroup dir="ltr">
                                <InputGroupAddon>
                                  <InputGroupText>https://</InputGroupText>
                                </InputGroupAddon>
                                <InputGroupInput
                                  id={`${uid}-link`}
                                  {...invalid("link")}
                                  inputMode="url"
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  placeholder="www.example.co.il"
                                  value={link}
                                  onChange={(e) => setLink(stripScheme(e.target.value))}
                                />
                              </InputGroup>
                              <FieldDescription>מספיק לכתוב את הכתובת, למשל www.example.co.il.</FieldDescription>
                              {errorFor("link")}
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-photo`}>תמונה של המקום (לא חובה)</FieldLabel>
                              {/* The native file input speaks the browser's language; this one is a quiet tile in ours. */}
                              <input
                                id={`${uid}-photo`}
                                type="file"
                                accept="image/*"
                                className="peer sr-only"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0]
                                  e.target.value = ""
                                  if (!f) return
                                  try {
                                    setPhoto(await resizeImage(f))
                                  } catch {
                                    setError("לא הצלחנו לקרוא את התמונה. נסו JPG או PNG.")
                                  }
                                }}
                              />
                              {photo ? (
                                <motion.div
                                  key={photo.length}
                                  className="relative overflow-hidden rounded-2xl"
                                  initial={{ clipPath: "inset(0% 0% 100% 0% round 16px)" }}
                                  animate={{ clipPath: "inset(0% 0% 0% 0% round 16px)" }}
                                  transition={{ duration: 0.55, ease }}
                                >
                                  <motion.img
                                    src={photo}
                                    alt=""
                                    className="aspect-[4/3] w-full object-cover"
                                    initial={{ scale: 1.08 }}
                                    animate={{ scale: 1 }}
                                    transition={{ duration: 0.9, ease }}
                                  />
                                  <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1.5">
                                    <Button asChild size="sm" variant="float" className="rounded-full">
                                      <label htmlFor={`${uid}-photo`} className="cursor-pointer">
                                        החלפה
                                      </label>
                                    </Button>
                                    <Button size="sm" variant="float" className="rounded-full" onClick={() => setPhoto(undefined)}>
                                      הסרה
                                    </Button>
                                  </div>
                                </motion.div>
                              ) : (
                                <label
                                  htmlFor={`${uid}-photo`}
                                  className="pressable flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong text-label text-ink-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:border-brand/50 hover:bg-surface-2 hover:text-ink-1"
                                >
                                  <ImagePlusIcon className="size-5" aria-hidden="true" />
                                  בחירת תמונה
                                </label>
                              )}
                              <FieldDescription>
                                התמונה מוקטנת, ונתוני המיקום שבקובץ נמחקים. היא נשלחת לבדיקה עם המקום, ומתפרסמת רק אם המקום אושר.
                              </FieldDescription>
                            </Field>
                            {photo && (
                              <>
                                <Field>
                                  <FieldLabel htmlFor={`${uid}-alt`}>מה רואים בתמונה?</FieldLabel>
                                  <Input
                                    id={`${uid}-alt`}
                                    {...invalid("alt")}
                                    value={photoAlt}
                                    onChange={(e) => setPhotoAlt(e.target.value)}
                                    maxLength={140}
                                  />
                                  <FieldDescription>תיאור קצר, בשביל מי שמשתמשים בקורא מסך.</FieldDescription>
                                  {errorFor("alt")}
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor={`${uid}-credit`}>מי צילם?</FieldLabel>
                                  <Input
                                    id={`${uid}-credit`}
                                    value={photoCredit}
                                    onChange={(e) => setPhotoCredit(e.target.value)}
                                    maxLength={60}
                                  />
                                </Field>
                                <Field orientation="horizontal">
                                  <Checkbox
                                    id={`${uid}-rights`}
                                    {...invalid("rights")}
                                    checked={photoRights}
                                    onCheckedChange={(v) => setPhotoRights(v === true)}
                                  />
                                  <FieldLabel htmlFor={`${uid}-rights`} className="leading-snug font-normal">
                                    {PHOTO_RIGHTS_TEXT}
                                  </FieldLabel>
                                  {errorFor("rights")}
                                </Field>
                              </>
                            )}
                          </FieldGroup>
                        )}

                        {step === 2 && (
                          <FieldGroup className="cascade">
                            <section className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-4" aria-label="סיכום ההצעה">
                              <div className="flex items-start gap-3">
                                {photo ? (
                                  <img src={photo} alt={photoAlt} className="size-16 shrink-0 rounded-xl object-cover" />
                                ) : (
                                  <Anemone size={40} variant="pale" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <h3 className="text-title-3 text-ink-1">{name}</h3>
                                  <p className="text-caption text-ink-2">
                                    {KINDS[kind].label}
                                    {inMemoryOf ? ` · לזכר ${inMemoryOf}` : ""}
                                  </p>
                                </div>
                              </div>
                              {story && <p className="text-body whitespace-pre-wrap text-ink-1">{story}</p>}
                              {link && (
                                <p className="text-caption break-all text-ink-2">
                                  <bdi>https://{link}</bdi>
                                </p>
                              )}
                              {photo && (
                                <p className="text-caption text-ink-2">
                                  תיאור התמונה: {photoAlt}
                                  {photoCredit && ` · צילום: ${photoCredit}`}
                                </p>
                              )}
                              <Button
                                variant="ghost"
                                className="min-h-11 self-start rounded-full"
                                onClick={() => {
                                  setError("")
                                  setStep(1)
                                }}
                              >
                                עריכת הפרטים
                              </Button>
                              <div className="border-t border-line pt-3 text-body text-ink-2">
                                <p>{placeHe || "המיקום שסימנתם במפה"}</p>
                                <p>
                                  {privateLand && !permission
                                    ? "מיקום משוער ברמת היישוב, ללא ניווט לשטח הפרטי."
                                    : "מיקום מדויק לפי הסיכה שבחרתם."}
                                </p>
                                {draft && (
                                  <p className="mt-1 text-caption tabular-nums">
                                    <bdi dir="ltr">
                                      {draft.lat.toFixed(privateLand && !permission ? 2 : 5)},{" "}
                                      {draft.lng.toFixed(privateLand && !permission ? 2 : 5)}
                                    </bdi>
                                  </p>
                                )}
                                {privateLand && permission && <p>{accessNote}</p>}
                              </div>
                              <Button
                                variant="ghost"
                                className="min-h-11 self-start rounded-full"
                                onClick={() => {
                                  setError("")
                                  setStep(0)
                                }}
                              >
                                עריכת המיקום
                              </Button>
                            </section>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-sub`}>השם שלכם (לא חובה)</FieldLabel>
                              <Input
                                id={`${uid}-sub`}
                                value={submitter}
                                onChange={(e) => setSubmitter(e.target.value)}
                                maxLength={60}
                                placeholder="למשל: המשפחה, חברים מהקיבוץ"
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-email`}>מייל (לא חובה)</FieldLabel>
                              <Input
                                id={`${uid}-email`}
                                {...invalid("email")}
                                type="email"
                                dir="ltr"
                                autoComplete="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                maxLength={254}
                              />
                              <FieldDescription>
                                נשלח אליו קודם מייל אימות, בלי פרטים על המקום. אחרי האימות נשלח את קישור המעקב ועדכון כשתתקבל החלטה. המייל
                                לא יתפרסם.
                              </FieldDescription>
                              {errorFor("email")}
                            </Field>
                            <Field orientation="horizontal">
                              <Checkbox
                                id={`${uid}-family`}
                                {...invalid("family")}
                                checked={family}
                                onCheckedChange={(v) => setFamily(v === true)}
                              />
                              <FieldLabel htmlFor={`${uid}-family`} className="leading-snug font-normal">
                                {FAMILY_CONSENT_TEXT}
                              </FieldLabel>
                              {errorFor("family")}
                            </Field>
                            {/* The notice sits beside the form it is about, as the privacy law asks, and before the box that says it was read. */}
                            <details className="group rounded-2xl border border-line px-4 py-3 text-caption text-ink-2">
                              <summary className="pressable cursor-pointer text-label text-ink-1 marker:text-ink-3">הודעת הפרטיות</summary>
                              <div
                                className="mt-2 flex flex-col gap-2 [&_a]:text-ink-1 [&_a]:underline [&_a]:underline-offset-2"
                                dangerouslySetInnerHTML={{ __html: NOTICE_HTML }}
                              />
                            </details>
                            <Field orientation="horizontal">
                              <Checkbox id={`${uid}-consent`} checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                              <FieldLabel htmlFor={`${uid}-consent`} className="leading-snug font-normal">
                                {CONSENT_TEXT}
                              </FieldLabel>
                            </Field>
                          </FieldGroup>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </motion.div>

                <AnimatePresence>
                  {error && !errorField && (
                    <motion.p
                      key={error}
                      role="alert"
                      className="mt-4 text-label text-destructive"
                      initial={{ opacity: 0, y: -4, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: lessMotion ? 0 : 0.22, ease }}
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>
              </fieldset>
            </div>
            <div
              className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-surface px-6 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"
              data-add-footer
            >
              {step > 0 ? (
                <Button variant="ghost" disabled={busy} onClick={() => setStep((s) => (s - 1) as Step)}>
                  חזרה
                </Button>
              ) : (
                <span />
              )}
              <motion.div key={shake} animate={shake ? { x: [0, -8, 7, -5, 3, 0] } : {}} transition={{ duration: 0.4 }}>
                {step < 2 ? (
                  <Button size="lg" className="pressable rounded-full px-6" onClick={next}>
                    המשך
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    variant="brand"
                    className="relative overflow-hidden rounded-full px-6"
                    disabled={!family || !consent || saved || busy}
                    aria-disabled={saved || busy}
                    aria-busy={busy}
                    onClick={save}
                  >
                    {busy ? "שולחים לבדיקה…" : "שליחה לבדיקה"}
                  </Button>
                )}
              </motion.div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <AnimatePresence>
        {open && picking && (
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            // The bar takes the focus when picking starts: a status region is read when it changes, not when it
            // appears, so without this VoiceOver said nothing and the instruction went unheard.
            ref={focusOnMount}
            tabIndex={-1}
            className="fixed inset-x-3 bottom-[max(16px,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full bg-glass p-2 ps-5 shadow-[0_20px_60px_-20px_rgb(0_0_0/0.5)] ring-1 ring-border outline-none"
            role="status"
          >
            <p className="text-label text-ink-1">{draft ? "אפשר לגרור את הסיכה, או ללחוץ במקום אחר" : "לחצו על המפה במקום המדויק"}</p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  // With a pin: remove it and keep picking. Without one: go back to the form.
                  if (draft) setDraft(null)
                  else setPicking(false)
                }}
              >
                {draft ? "הסרת הסיכה" : "ביטול"}
              </Button>
              <Button className="rounded-full" onClick={() => setPicking(false)} disabled={!draft}>
                זה המקום
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
