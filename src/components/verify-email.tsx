import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { confirmEmail } from "@/lib/api"
import { useStore } from "@/store"

const RESULT = {
  ok: "הכתובת אומתה. שלחנו אליה את קישור המעקב, ונעדכן אותה כשתתקבל החלטה.",
  expired: "הקישור הזה כבר לא בתוקף, או שלא הועתק במלואו. ההצעה עצמה לא נפגעה.",
  failed: "אין חיבור לשרת כרגע. נסו שוב בעוד רגע.",
} as const

/**
 * Opened from the link in the verification mail. Confirming takes a click on purpose: mail scanners open links, and
 * an address must not count as confirmed because one did.
 */
export function VerifyEmail() {
  const token = useStore((s) => s.verifying)
  const setVerifying = useStore((s) => s.setVerifying)
  const [result, setResult] = useState<keyof typeof RESULT | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={!!token} onOpenChange={(v) => !v && setVerifying(null)}>
      <DialogContent dir="rtl" className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>אימות כתובת המייל</DialogTitle>
          <DialogDescription>כדי שנוכל לשלוח לכתובת שהשארתם את קישור המעקב ועדכונים על ההצעה.</DialogDescription>
        </DialogHeader>
        <div aria-live="polite">
          {result ? (
            <p className="text-ink-1">{RESULT[result]}</p>
          ) : (
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
              אישור הכתובת
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
