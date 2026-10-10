import { useEffect, useRef, useState } from "react"
import { CheckCircle2Icon, LoaderCircleIcon, MailIcon } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CONTACT_EMAIL } from "@/config"
import { turnstileToken } from "@/lib/turnstile"

/** A transient form: closing erases the fields. Only the server's confirmed provider acceptance shows success. */
export function ContactForm({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [copyStatus, setCopyStatus] = useState("")
  const notice = useRef<HTMLParagraphElement>(null)
  const lock = useRef(false)
  useEffect(() => {
    const abort = new AbortController()
    void fetch("/api/v1/contact", { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6000)]) })
      .then(async (r) => setEnabled(r.ok && (await r.json()).enabled === true))
      .catch(() => {
        if (!abort.signal.aborted) setEnabled(false)
      })
    return () => abort.abort()
  }, [])
  useEffect(() => {
    if (error || sent) notice.current?.focus()
  }, [error, attempt, sent])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!enabled || lock.current) return
    lock.current = true
    setBusy(true)
    setError("")
    const n = attempt + 1
    setAttempt(n)
    try {
      const token = await turnstileToken("contact")
      if (!token) {
        setError(`ניסיון ${n}: בדיקת האבטחה לא הושלמה. ההודעה לא נשלחה. אפשר לנסות שוב.`)
        return
      }
      const r = await fetch("/api/v1/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Turnstile-Token": token },
        body: JSON.stringify({ email: email.trim(), message: message.trim() }),
        signal: AbortSignal.timeout(20_000),
      })
      if (r.status === 202 && (await r.json()).accepted === true) {
        setSent(true)
        setEmail("")
        setMessage("")
      } else {
        setError(
          r.status === 429
            ? `ניסיון ${n}: נשלחו כמה פניות ברצף. המתינו דקה ונסו שוב.`
            : `ניסיון ${n}: לא התקבל אישור לשליחה. אפשר לנסות שוב, או לפנות לכתובת שמופיעה למטה.`,
        )
      }
    } catch {
      setError(`ניסיון ${n}: לא התקבל אישור. ייתכן שההודעה הגיעה, ולכן לא נשלח אותה שוב אוטומטית.`)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader className="gap-3 pe-10">
          {sent ? (
            <CheckCircle2Icon className="size-8 text-hope" aria-hidden="true" />
          ) : (
            <MailIcon className="size-7 text-ink-2" aria-hidden="true" />
          )}
          <DialogTitle className="text-title-2">{sent ? "תודה שכתבתם לנו" : "כתבו לנו"}</DialogTitle>
          <DialogDescription>
            {sent ? "ההודעה הועברה לשירות הדואר. נוכל להשיב לכתובת שהשארתם." : "שאלה, רעיון או משהו שחשוב לכם שנדע? נשמח לשמוע."}
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <>
            <p ref={notice} tabIndex={-1} className="text-body text-ink-2 outline-none">
              הפנייה אינה מתפרסמת באתר.
            </p>
            <Button className="rounded-full" onClick={onClose}>
              חזרה למפה
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="contact-email" className="text-label">
                כתובת אימייל לתשובה
              </label>
              <Input
                id="contact-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="contact-message" className="text-label">
                מה תרצו לומר לנו?
              </label>
              <Textarea
                id="contact-message"
                required
                maxLength={2000}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={busy}
              />
            </div>
            <p className="text-caption text-ink-2">הפרטים משמשים לטיפול בפנייה. הטופס אינו שומר טיוטות; בסגירת החלון הטקסט מתאפס.</p>
            {enabled === false && (
              <p role="status" className="rounded-xl border border-line bg-surface-2 p-3 text-body text-ink-2">
                השליחה מתוך האתר עדיין אינה פעילה. בינתיים אפשר לפנות לכתובת האימייל של המיזם.
              </p>
            )}
            {error && (
              <p
                key={attempt}
                ref={notice}
                role="alert"
                tabIndex={-1}
                className="rounded-xl border border-line p-3 text-body text-ink-1 outline-none"
              >
                {error}
              </p>
            )}
            <Button type="submit" className="min-h-12 rounded-full" disabled={!enabled || busy || !email.trim() || !message.trim()}>
              {busy && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {busy
                ? `שולחים פנייה - ניסיון ${attempt}…`
                : enabled === null
                  ? "בודקים את חיבור הדואר…"
                  : error
                    ? "ניסיון שליחה נוסף"
                    : "שליחת הפנייה"}
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <span dir="ltr" className="text-caption select-all">
                {CONTACT_EMAIL}
              </span>
              <Button
                type="button"
                variant="ghost"
                className="rounded-full"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(CONTACT_EMAIL)
                    setCopyStatus("הכתובת הועתקה")
                  } catch {
                    setCopyStatus("אפשר לסמן ולהעתיק את הכתובת")
                  }
                }}
              >
                העתקת הכתובת
              </Button>
            </div>
            {copyStatus && (
              <p role="status" className="text-caption text-ink-2">
                {copyStatus}
              </p>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
