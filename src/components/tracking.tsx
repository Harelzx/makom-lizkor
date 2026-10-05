import { useEffect, useState } from "react"
import { CopyIcon } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CONSENT_TEXT, noticeHtml } from "@/data/legal"
import { reviseSubmission, trackSubmission, withdrawSubmission, type Draft, type Tracked } from "@/lib/api"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { useStore } from "@/store"

/** What each state means to the person who sent the place. */
const STATUS: Record<string, string> = {
  pending: "ממתינה לבדיקה",
  returned: "הוחזרה אליכם לתיקון",
  published: "אושרה ומופיעה באתר",
  rejected: "לא אושרה",
  hidden: "מוסתרת עד שתסתיים בדיקה",
  withdrawn: "נמשכה. ההצעה, השם והמייל שלכם והתמונה נמחקו מהשרת",
  erased: "נמחקה",
}

/** Once withdrawn or erased, there is nothing left to take back. */
const FINAL = new Set(["withdrawn", "erased"])

/**
 * A submission's status, opened from its private tracking link or from the sender's own card. The link is the only
 * key to it: whoever holds it can see the status and withdraw the place, so the view says to keep it private.
 */
/** A correction can be sent for a place returned to its sender, or for one already published with nothing waiting. */
const correctable = (t: Tracked) => t.status === "returned" || (t.status === "published" && t.revision_state !== "pending")

const stripScheme = (v: string) => v.trim().replace(/^https?:\/\//i, "")

/**
 * The sender's correction: the text again, whole, as they want it to appear. The kind and the point stay as they were.
 * It is a new submission of text, so it shows the same notice and asks for the same agreement as the add form.
 */
function Correction({ draft, onSend }: { draft: Draft; onSend: (d: Draft) => Promise<void> }) {
  const [d, setD] = useState({ ...draft, link_url: draft.link_url ? stripScheme(draft.link_url) : "" })
  const [agreed, setAgreed] = useState(false)
  const [sending, setSending] = useState(false)
  const field = (k: keyof Draft) => ({
    value: d[k] ?? "",
    onChange: (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value }),
  })
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!d.name_he.trim() || !agreed || sending) return
        setSending(true)
        await onSend({ ...d, link_url: d.link_url ? `https://${stripScheme(d.link_url)}` : null })
        setSending(false)
      }}
    >
      <Field>
        <FieldLabel htmlFor="fix-name">שם המקום</FieldLabel>
        <Input id="fix-name" required maxLength={80} {...field("name_he")} />
      </Field>
      <Field>
        <FieldLabel htmlFor="fix-place">יישוב או אזור</FieldLabel>
        <Input id="fix-place" maxLength={80} {...field("place_he")} />
      </Field>
      <Field>
        <FieldLabel htmlFor="fix-mem">לזכר (לא חובה)</FieldLabel>
        <Input id="fix-mem" maxLength={120} {...field("in_memory_of")} />
      </Field>
      <Field>
        <FieldLabel htmlFor="fix-story">כמה מילים על המקום (לא חובה)</FieldLabel>
        <Textarea id="fix-story" maxLength={2000} {...field("story_he")} />
      </Field>
      <Field>
        <FieldLabel htmlFor="fix-link">קישור לאתר הנצחה (לא חובה)</FieldLabel>
        <Input id="fix-link" dir="ltr" maxLength={300} {...field("link_url")} />
      </Field>
      <details className="rounded-2xl border border-line px-4 py-3 text-caption text-ink-2">
        <summary className="pressable cursor-pointer text-label text-ink-1">הודעת הפרטיות ותנאי השליחה</summary>
        <div
          className="mt-2 flex flex-col gap-2 [&_a]:text-ink-1 [&_a]:underline [&_a]:underline-offset-2"
          dangerouslySetInnerHTML={{ __html: noticeHtml(CURRENT_SUBMISSION_NOTICE) }}
        />
      </details>
      <Field orientation="horizontal">
        <Checkbox id="fix-consent" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
        <FieldLabel htmlFor="fix-consent" className="leading-snug font-normal">
          {CONSENT_TEXT}
        </FieldLabel>
      </Field>
      <Button type="submit" className="pressable self-start" disabled={!agreed || !d.name_he.trim() || sending}>
        שליחה מחדש לבדיקה
      </Button>
    </form>
  )
}

export function Tracking() {
  const tracking = useStore((s) => s.tracking)
  const setTracking = useStore((s) => s.setTracking)
  // undefined: loading or unreachable · null: no such submission for this link
  const [state, setState] = useState<{ key: string; result: Tracked | null | undefined; failed: boolean } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [fixing, setFixing] = useState(false)
  const key = tracking ? `${tracking.id}/${tracking.token}` : ""

  useEffect(() => {
    if (!tracking) return
    let live = true
    void trackSubmission(tracking.id, tracking.token).then((result) => {
      if (live) setState({ key: `${tracking.id}/${tracking.token}`, result, failed: result === undefined })
    })
    return () => {
      live = false
    }
  }, [tracking])

  const current = state?.key === key ? state : null
  const reload = async () => {
    if (!tracking) return
    const result = await trackSubmission(tracking.id, tracking.token)
    setState({ key: `${tracking.id}/${tracking.token}`, result, failed: result === undefined })
  }

  const sendCorrection = async (d: Draft) => {
    if (!tracking || current?.result?.rev === undefined) return
    const sent = {
      name_he: d.name_he.trim(),
      place_he: d.place_he?.trim() || undefined,
      in_memory_of: d.in_memory_of?.trim() || undefined,
      story_he: d.story_he?.trim() || undefined,
      link_url: d.link_url || undefined,
    }
    const r = await reviseSubmission(tracking.id, tracking.token, {
      expectedRev: current.result.rev,
      ...sent,
      consent_version: CURRENT_SUBMISSION_NOTICE,
    })
    if (r === "refused") return void toast("התיקון לא התקבל", { description: "התיקון נשאר כאן. בדקו אותו ונסו לשלוח שוב." })
    if (r === "failed") return void toast("לא הצלחנו לשלוח את התיקון", { description: "התיקון לא נשמר ונשאר כאן. נסו שוב בעוד רגע." })
    if (r === "queue_full")
      return void toast("יש עכשיו יותר הצעות ממה שאפשר לבדוק", { description: "התיקון לא נשמר. נסו שוב בעוד כמה שעות." })
    if (r === "uncertain") {
      // No clear answer: the correction may have been saved. It counts as saved only if the newest text on the server
      // is the very text sent from here (another tab may have sent a different one); otherwise it stays in the form.
      const now = await trackSubmission(tracking.id, tracking.token)
      const same = (a?: string | null, b?: string | null) => (a ?? "") === (b ?? "")
      const mine =
        !!now?.draft &&
        now.rev !== current.result.rev &&
        (Object.keys(sent) as (keyof typeof sent)[]).every((k) => same(now.draft![k], sent[k]))
      if (!mine) {
        if (now) setState({ key, result: now, failed: false })
        return void toast(now ? "התיקון שלכם לא מופיע בשרת" : "לא ברור אם התיקון נשמר", {
          description:
            now && now.rev !== current.result.rev
              ? "ההצעה השתנתה בינתיים, אולי מחלון אחר. התיקון שלכם נשאר כאן; בדקו את המצב לפני ששולחים שוב."
              : "התיקון נשאר כאן. נסו שוב בעוד רגע.",
        })
      }
    }
    if (r === "conflict") toast("ההצעה השתנתה בינתיים", { description: "הנה המצב העדכני." })
    setFixing(false)
    await reload()
  }
  const link = tracking ? `${location.origin}/#/track/${encodeURIComponent(tracking.id)}/${encodeURIComponent(tracking.token)}` : ""

  const withdraw = async () => {
    if (!tracking) return
    setWorking(true)
    const done = await withdrawSubmission(tracking.id, tracking.token)
    // The status says what is established, whatever the answer was (or if none came): withdrawn, and whether its files
    // are still to be erased.
    const now = await trackSubmission(tracking.id, tracking.token)
    setWorking(false)
    setConfirming(false)
    if (now?.status === "withdrawn") setState({ key, result: now, failed: false })
    else if (done === "failed" || now) return void toast("לא הצלחנו לוודא שההצעה נמשכה", { description: "נסו שוב בעוד רגע." })
    // Withdrawn, but the status couldn't be read just now: say only what the answer established.
    else
      setState({
        key,
        result: { status: "withdrawn", name_he: null, ...(done === "withdrawn" ? {} : { files: "pending" }) },
        failed: false,
      })
    // The sender's own copy on this device, if it is here, says so too.
    const own = useStore.getState().local.find((p) => p.local?.remoteId === tracking.id)
    if (own) void useStore.getState().updateLocal(own.id, { send: "withdrawn" })
  }

  return (
    <Dialog open={!!tracking} onOpenChange={(v) => !v && setTracking(null)}>
      <DialogContent dir="rtl" className="max-h-[92dvh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>מצב ההצעה</DialogTitle>
          <DialogDescription>מה קרה עם המקום ששלחתם לבדיקה.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4" aria-live="polite">
          {!current && <p className="text-ink-2">בודקים…</p>}
          {current?.result === null && <p className="text-ink-1">לא מצאנו הצעה בקישור הזה. אולי הקישור לא הועתק במלואו.</p>}
          {current?.failed && <p className="text-ink-1">אין חיבור לשרת כרגע. נסו שוב בעוד רגע.</p>}
          {current?.result && (
            <>
              {current.result.name_he && <p className="text-title-3 text-ink-1">{current.result.name_he}</p>}
              <p className="text-label text-ink-1">
                {current.result.status === "withdrawn" && current.result.files === "pending"
                  ? "נמשכה. ההצעה, השם והמייל שלכם נמחקו מהשרת. התמונה כבר לא מוצגת, ותימחק מהשרת בהמשך"
                  : (STATUS[current.result.status] ?? current.result.status)}
              </p>
              {current.result.status === "published" && current.result.revision_state === "pending" && (
                <p className="text-caption text-ink-2">התיקון ששלחתם ממתין לבדיקה. עד אז מופיעה הגרסה הקודמת.</p>
              )}
              {current.result.status === "published" && current.result.revision_state === "rejected" && (
                <p className="text-caption text-ink-2">התיקון האחרון לא אושר. באתר מופיעה הגרסה שאושרה.</p>
              )}
              {current.result.note && (
                <div className="rounded-2xl border border-line p-3">
                  <p className="text-caption text-ink-2">הערת המאשרים</p>
                  <p className="whitespace-pre-line text-ink-1">{current.result.note}</p>
                </div>
              )}
              {correctable(current.result) && current.result.draft && !fixing && (
                <Button variant="outline" className="pressable self-start" onClick={() => setFixing(true)}>
                  תיקון ההצעה
                </Button>
              )}
              {fixing && current.result.draft && <Correction draft={current.result.draft} onSend={sendCorrection} />}
            </>
          )}
          {current?.result && !FINAL.has(current.result.status) && (
            <>
              <Field>
                <FieldLabel htmlFor="tracking-link">קישור המעקב</FieldLabel>
                <InputGroup>
                  <InputGroupInput id="tracking-link" readOnly value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="העתקת הקישור"
                      onClick={() => void navigator.clipboard?.writeText(link).then(() => toast("הקישור הועתק"))}
                    >
                      <CopyIcon />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>מי שיש לו את הקישור יכול לראות את ההצעה ולמשוך אותה, ולכן כדאי לא להעביר אותו הלאה.</FieldDescription>
              </Field>
              <Button variant="outline" className="pressable self-start" onClick={() => setConfirming(true)}>
                משיכת ההצעה
              </Button>
            </>
          )}
        </div>
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>למשוך את ההצעה?</AlertDialogTitle>
              <AlertDialogDescription>
                המקום, הסיפור, השם והמייל שלכם והתמונה יימחקו מהשרת מיד, וגם אם המקום כבר פורסם הוא ירד מהאתר. אי אפשר לבטל את זה.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction
                disabled={working}
                onClick={(e) => {
                  e.preventDefault()
                  void withdraw()
                }}
              >
                למשוך ולמחוק
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
