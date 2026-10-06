import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { confirmEmail, type Confirmed } from "@/lib/api"
import { useStore } from "@/store"

// Each says what actually happened to the tracking mail, so a visitor whose mail didn't go knows to try again.
const RESULT: Record<Confirmed, string> = {
  ok: "הכתובת אומתה. שלחנו אליה את קישור המעקב, ונעדכן אותה כשתתקבל החלטה.",
  resent: "הכתובת כבר אומתה. שלחנו אליה עכשיו את קישור המעקב.",
  again: "הכתובת כבר אומתה קודם. קישור המעקב נשלח אליה אז.",
  unsent: "הכתובת אומתה, אבל קישור המעקב לא נשלח אליה הפעם. נסו שוב בעוד כמה דקות.",
  stopped: "הכתובת אומתה, אבל לא הצלחנו לשלוח אליה את קישור המעקב, ולא ננסה שוב. ההצעה עצמה לא נפגעה.",
  expired: "הקישור הזה כבר לא בתוקף, או שלא הועתק במלואו. ההצעה עצמה לא נפגעה.",
  failed: "אין חיבור לשרת כרגע. נסו שוב בעוד רגע.",
}
/** Outcomes where pressing again can still help. */
const RETRY = new Set<Confirmed>(["unsent", "failed"])

/**
 * Opened from the link in the verification mail. Confirming takes a click on purpose: mail scanners open links, and
 * an address must not count as confirmed because one did.
 */
export function VerifyEmail() {
  const token = useStore((s) => s.verifying)
  const setVerifying = useStore((s) => s.setVerifying)
  const [result, setResult] = useState<Confirmed | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={!!token} onOpenChange={(v) => !v && setVerifying(null)}>
      <DialogContent dir="rtl" className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>אימות כתובת המייל</DialogTitle>
          <DialogDescription>כדי שנוכל לשלוח לכתובת שהשארתם את קישור המעקב ועדכונים על ההצעה.</DialogDescription>
        </DialogHeader>
        <div aria-live="polite" className="flex flex-col items-start gap-3">
          {result && <p className="text-ink-1">{RESULT[result]}</p>}
          {(!result || RETRY.has(result)) && (
            <Button
              className="pressable"
              disabled={busy}
              onClick={async () => {
                if (!token) return
                setBusy(true)
                setResult(await confirmEmail(token))
                setBusy(false)
              }}
            >
              {result ? "לנסות שוב" : "אישור הכתובת"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
