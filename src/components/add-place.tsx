import { useEffect, useId, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { CheckIcon, CrosshairIcon, DownloadIcon, ImagePlusIcon, LocateFixedIcon, MapPinIcon, UploadIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Anemone } from "@/components/anemone"
import { ADDABLE_KINDS, KINDS } from "@/data/taxonomy"
import { CONSENT_TEXT, FAMILY_CONSENT_TEXT, noticeHtml, PHOTO_RIGHTS_TEXT } from "@/data/legal"
import { submitPlace } from "@/lib/api"
import { downloadJSON, resizeImage } from "@/lib/storage"
import { getMap, reducedMotion } from "@/map/controller"
import { useStore } from "@/store"
import { ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { SubmissionInput } from "@/shared/contract"
import type { Kind, Place } from "@/types"

type Step = 0 | 1 | 2

// The form sends the place for review, so it shows the notice for submissions, the version recorded with each one.
const SUBMISSION_NOTICE = "notice.submission@2026-10-1" as const
const NOTICE_HTML = noticeHtml(SUBMISSION_NOTICE)

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
  "ההצעה תישלח לבדיקה ותופיע לכולם אחרי אישור. עד אז היא מוצגת רק אצלכם.",
]
/** The flower opens as the form moves on: a bud, then one anemone, then a bouquet. */
const ART = ["/art/bud.webp", "/art/anemone-watercolor.webp", "/art/bouquet.webp"]
/** And the sky behind it warms toward morning, the way the map does at the opening. */
const SKY = [
  "bg-[radial-gradient(130%_120%_at_20%_0%,var(--p-sky-100),var(--p-field-50)_55%,var(--surface)_100%)] dark:bg-[radial-gradient(130%_120%_at_20%_0%,var(--p-ink-700),var(--p-ink-800)_60%,var(--surface)_100%)]",
  "bg-[radial-gradient(130%_120%_at_20%_0%,var(--p-sun-100),var(--p-field-50)_55%,var(--surface)_100%)] dark:bg-[radial-gradient(130%_120%_at_20%_0%,var(--p-dusk),var(--p-ink-800)_60%,var(--surface)_100%)]",
  "bg-[radial-gradient(120%_130%_at_20%_10%,var(--p-sun-200),var(--p-anemone-50)_50%,var(--surface)_100%)] dark:bg-[radial-gradient(120%_130%_at_20%_10%,color-mix(in_oklab,var(--p-anemone-700)_45%,var(--p-dusk)),var(--p-ink-800)_60%,var(--surface)_100%)]",
]
/** Steps turn like pages in a Hebrew book: the next one comes in from the left, going back returns from the right. */
const turn = {
  enter: (d: number) => ({ x: d * -40, opacity: 0, filter: "blur(4px)" }),
  center: { x: 0, opacity: 1, filter: "blur(0px)" },
  leave: (d: number) => ({ x: d * 40, opacity: 0, filter: "blur(4px)" }),
}
/** Headings roll to the next line instead of being swapped in place. */
const roll = {
  enter: (d: number) => ({ y: d * 14, opacity: 0, filter: "blur(3px)" }),
  center: { y: 0, opacity: 1, filter: "blur(0px)" },
  leave: (d: number) => ({ y: d * -14, opacity: 0, filter: "blur(3px)" }),
}

export function AddPlace() {
  const open = useStore((s) => s.addOpen)
  const setOpen = useStore((s) => s.setAddOpen)
  const picking = useStore((s) => s.picking)
  const setPicking = useStore((s) => s.setPicking)
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const addLocal = useStore((s) => s.addLocal)
  const select = useStore((s) => s.select)
  const local = useStore((s) => s.local)
  const importLocal = useStore((s) => s.importLocal)

  const [step, setStepRaw] = useState<Step>(0)
  // which way the steps slide: forward comes in from the reading direction, back returns the other way
  const [dir, setDir] = useState(1)
  const setStep = (next: Step | ((s: Step) => Step)) =>
    setStepRaw((cur) => {
      const n = typeof next === "function" ? next(cur) : next
      setDir(n >= cur ? 1 : -1)
      return n
    })
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
  const [family, setFamily] = useState(false)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const uid = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  // The step area grows and shrinks to fit each step, instead of the dialog jumping between sizes.
  const [bodyH, setBodyH] = useState(0)
  const measureBody = (el: HTMLDivElement | null) => {
    if (!el) return
    const ro = new ResizeObserver(() => setBodyH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }
  // A new step takes focus at its heading, so keyboards start there and screen readers read where they are.
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) {
      moved.current = true
      return
    }
    // a long step may have been scrolled; the next one starts from its top, not from an empty stretch
    titleRef.current?.closest('[data-slot="dialog-content"]')?.scrollTo({ top: 0 })
    titleRef.current?.focus({ preventScroll: true })
  }, [step])

  const reset = () => {
    setStep(0)
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
    setFamily(false)
    setConsent(false)
    setError("")
  }

  const locate = () => {
    if (!navigator.geolocation) return setError("הדפדפן לא תומך באיתור מיקום. סמנו את המקום על המפה.")
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setDraft(p)
        setError("")
        getMap()?.flyTo({ center: [p.lng, p.lat], zoom: 17, duration: reducedMotion() ? 0 : 2000 })
      },
      () => setError("לא הצלחנו לאתר את המיקום. אפשר לסמן אותו על המפה."),
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  const fail = (msg: string) => {
    setError(msg)
    setShake((n) => n + 1)
    navigator.vibrate?.(30)
  }

  const next = () => {
    if (step === 0) {
      if (!draft) return fail("סמנו קודם את המקום על המפה.")
      if (draft.lat < 29.4 || draft.lat > 33.45 || draft.lng < 34.2 || draft.lng > 35.95)
        return fail("הנקודה מחוץ לאזור שהמפה מכסה. סמנו שוב.")
    }
    if (step === 1) {
      if (!name.trim()) return fail('כתבו איך נקרא המקום, למשל "הספסל של נועה".')
      if (link && !looksLikeAddress(link)) return fail("הכתובת לא נראית תקינה. כתבו אותה כך: www.example.co.il")
      if (photo && !photoAlt.trim()) return fail("כתבו במשפט קצר מה רואים בתמונה.")
      if (photo && !photoRights) return fail("כדי לצרף תמונה צריך לאשר שיש לכם זכות להשתמש בה.")
    }
    setError("")
    setStep((s) => (s + 1) as Step)
  }

  const save = async () => {
    if (!draft) return setStep(0)
    if (!family || !consent) return fail("כדי לשמור צריך לסמן את שתי ההצהרות.")
    if (saved) return
    const now = new Date().toISOString()
    const place: Place = {
      id: `local-${Date.now().toString(36)}`,
      name_he: name.trim(),
      kind,
      lat: +draft.lat.toFixed(6),
      lng: +draft.lng.toFixed(6),
      precision: "exact",
      place_he: placeHe.trim() || "נוסף על ידי משפחה או חברים",
      summary_he: story.trim(),
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
    // Sent for review first; the local copy is kept either way, and steps aside once the approved place reaches the feed.
    // The photo stays on this device until uploads arrive (phase 2).
    const sent = await submitPlace({
      kind: kind as SubmissionInput["kind"],
      name_he: place.name_he,
      lat: place.lat,
      lng: place.lng,
      place_he: placeHe.trim() || undefined,
      in_memory_of: inMemoryOf.trim() || undefined,
      story_he: story.trim() || undefined,
      link_url: link ? `https://${link}` : undefined,
      submitter_name: submitter.trim() || undefined,
      on_private_property: false,
      consent_version: SUBMISSION_NOTICE,
    })
    if (sent && place.local) {
      place.local.remoteId = sent.id
      place.local.trackingToken = sent.trackingToken
    }
    await addLocal(place)
    // The button confirms first; then the dialog steps aside and the map flies to the new flower.
    setSaved(true)
    navigator.vibrate?.([20, 40, 20])
    setTimeout(
      () => {
        setOpen(false)
        setDraft(null)
        // cleared once the dialog has gone, so it never flashes back to the first step on its way out
        setTimeout(() => {
          reset()
          setSaved(false)
        }, 300)
        useStore.getState().setTab("places")
        select(place.id)
        useStore.getState().celebrate()
        toast("הכלנית במקומה", {
          description: sent ? "ההצעה נשלחה לבדיקה. היא תופיע לכולם אחרי אישור." : "לא הצלחנו לשלוח כרגע. המקום נשמר במכשיר הזה.",
          duration: 6000,
        })
      },
      reducedMotion() ? 0 : 650,
    )
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
      <Dialog open={open && !picking} onOpenChange={(v) => setOpen(v)}>
        <DialogContent dir="rtl" className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
          <div className="relative h-28 shrink-0 overflow-hidden rounded-t-[inherit]" aria-hidden="true">
            {SKY.map((sky, i) => (
              <motion.div
                key={i}
                className={cn("absolute inset-0", sky)}
                initial={false}
                animate={{ opacity: i <= step ? 1 : 0 }}
                transition={{ duration: 0.7, ease }}
              />
            ))}
            <AnimatePresence initial={false}>
              <motion.img
                key={step}
                src={ART[step]}
                alt=""
                className="absolute -bottom-10 left-8 w-36 origin-bottom drop-shadow-lg"
                initial={{ y: 46, rotate: -22, scale: 0.85, opacity: 0, filter: "blur(4px)" }}
                animate={{ y: 0, rotate: -8, scale: 1, opacity: 1, filter: "blur(0px)" }}
                exit={{ y: 24, scale: 0.92, opacity: 0, filter: "blur(4px)", transition: { duration: 0.2, ease } }}
                transition={{ type: "spring", stiffness: 170, damping: 15 }}
              />
            </AnimatePresence>
          </div>
          <DialogHeader className="gap-2 px-6 pt-2">
            <div className="flex flex-col gap-2.5">
              <ol className="flex items-center gap-4" aria-label={`שלב ${step + 1} מתוך 3`}>
                {STEPS.map((label, i) => (
                  <li
                    key={label}
                    className="flex items-center gap-1.5 text-caption font-semibold"
                    aria-current={i === step ? "step" : undefined}
                  >
                    <span
                      className={cn(
                        "relative grid size-5 place-items-center rounded-full transition-colors duration-300",
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
                        <span className="text-micro tabular-nums">{i + 1}</span>
                      )}
                    </span>
                    <span className={cn("transition-colors duration-300", i === step ? "text-ink-1" : "text-ink-3")}>{label}</span>
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
                  initial="enter"
                  animate="center"
                  exit="leave"
                  transition={{ duration: 0.28, ease }}
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
                  initial="enter"
                  animate="center"
                  exit="leave"
                  transition={{ duration: 0.28, ease, delay: 0.03 }}
                >
                  {DESCRIPTIONS[step]}
                </motion.span>
              </AnimatePresence>
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pt-5 pb-6" onKeyDown={onKeyDown}>
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
                    initial="enter"
                    animate="center"
                    exit="leave"
                    transition={{ duration: 0.3, ease }}
                  >
                    {step === 0 && (
                      <FieldGroup className="cascade">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button variant="outline" className="h-14 justify-start rounded-2xl" onClick={() => setPicking(true)}>
                            <CrosshairIcon data-icon="inline-start" />
                            סימון על המפה
                          </Button>
                          <Button variant="outline" className="h-14 justify-start rounded-2xl" onClick={locate}>
                            <LocateFixedIcon data-icon="inline-start" />
                            המיקום הנוכחי שלי
                          </Button>
                        </div>
                        {draft && (
                          <Alert key={`${draft.lat},${draft.lng}`}>
                            <MapPinIcon className="pin-drop text-brand" />
                            <AlertDescription className="tabular-nums">
                              סומן מיקום ({draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}). אפשר לגרור את הסיכה במפה כדי לדייק.
                            </AlertDescription>
                            <AlertAction>
                              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                                <XIcon data-icon="inline-start" />
                                הסרת הסיכה
                              </Button>
                            </AlertAction>
                          </Alert>
                        )}
                        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
                          <p className="text-label text-ink-1">המקומות שהוספתם</p>
                          <p className="text-caption text-ink-2">
                            {local.length === 0
                              ? "עוד לא הוספתם מקומות מהמכשיר הזה."
                              : `${local.length === 1 ? "מקום אחד" : `${local.length} מקומות`} שמור במכשיר. ייצאו לקובץ ושלחו לנו כדי שיופיעו אצל כולם.`}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!local.length}
                              onClick={() => downloadJSON("makom-lizkor-places.json", local)}
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
                                      const n = await importLocal(Array.isArray(data) ? data : [])
                                      toast(n ? `נוספו ${n} מקומות` : "לא נמצאו בקובץ מקומות חדשים")
                                    } catch {
                                      toast("הקובץ לא נקרא. צריך קובץ JSON שיוצא מכאן.")
                                    }
                                  }}
                                />
                              </label>
                            </Button>
                          </div>
                        </div>
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
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={80}
                            placeholder='למשל "מצפור עומר"'
                          />
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
                          <Textarea id={`${uid}-story`} value={story} onChange={(e) => setStory(e.target.value)} maxLength={600} rows={4} />
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
                          <FieldDescription>התמונה מוקטנת ונשמרת רק במכשיר הזה. נתוני המיקום שבקובץ נמחקים.</FieldDescription>
                        </Field>
                        {photo && (
                          <>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-alt`}>מה רואים בתמונה?</FieldLabel>
                              <Input id={`${uid}-alt`} value={photoAlt} onChange={(e) => setPhotoAlt(e.target.value)} maxLength={140} />
                              <FieldDescription>תיאור קצר, בשביל מי שמשתמשים בקורא מסך.</FieldDescription>
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
                              <Checkbox id={`${uid}-rights`} checked={photoRights} onCheckedChange={(v) => setPhotoRights(v === true)} />
                              <FieldLabel htmlFor={`${uid}-rights`} className="leading-snug font-normal">
                                {PHOTO_RIGHTS_TEXT}
                              </FieldLabel>
                            </Field>
                          </>
                        )}
                      </FieldGroup>
                    )}

                    {step === 2 && (
                      <FieldGroup className="cascade">
                        <div className="flex items-center gap-4 border-y border-line py-4">
                          <Anemone size={44} variant="pale" />
                          <div className="min-w-0">
                            <p className="truncate text-title-3 text-ink-1">{name}</p>
                            <p className="text-caption text-ink-2">
                              {KINDS[kind].label}
                              {inMemoryOf ? ` · לזכר ${inMemoryOf}` : ""}
                            </p>
                          </div>
                        </div>
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
                        <Field orientation="horizontal">
                          <Checkbox id={`${uid}-family`} checked={family} onCheckedChange={(v) => setFamily(v === true)} />
                          <FieldLabel htmlFor={`${uid}-family`} className="leading-snug font-normal">
                            {FAMILY_CONSENT_TEXT}
                          </FieldLabel>
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
              {error && (
                <motion.p
                  key={error}
                  role="alert"
                  className="mt-4 text-label text-destructive"
                  initial={{ opacity: 0, y: -4, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease }}
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="mt-6 flex items-center justify-between gap-2">
              {step > 0 ? (
                <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)}>
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
                    disabled={!family || !consent}
                    aria-disabled={saved}
                    onClick={save}
                  >
                    <motion.span
                      animate={saved ? { y: -14, opacity: 0, filter: "blur(3px)" } : { y: 0, opacity: 1, filter: "blur(0px)" }}
                      transition={{ duration: 0.2, ease }}
                    >
                      שמירה והנחת כלנית
                    </motion.span>
                    <AnimatePresence>
                      {saved && (
                        <motion.span
                          className="absolute inset-0 flex items-center justify-center gap-1.5"
                          initial={{ y: 14, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={spring.bouncy}
                          role="status"
                        >
                          <CheckIcon className="size-4" />
                          נשמר
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Button>
                )}
              </motion.div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {open && picking && (
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            className="fixed inset-x-3 bottom-[max(16px,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full bg-glass p-2 ps-5 shadow-[0_20px_60px_-20px_rgb(0_0_0/0.5)] ring-1 ring-border"
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
