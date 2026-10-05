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
import { trackSubmission, withdrawSubmission, type Tracked } from "@/lib/api"
import { useStore } from "@/store"

/** What each state means to the person who sent the place. */
const STATUS: Record<string, string> = {
  pending: "ממתינה לבדיקה",
  returned: "הוחזרה אליכם לתיקון",
  published: "אושרה ומופיעה באתר",
  rejected: "לא אושרה",
  hidden: "מוסתרת עד שתסתיים בדיקה",
  withdrawn: "נמשכה. ההצעה והשם שלכם נמחקו מהשרת",
  erased: "נמחקה",
}

/** Once withdrawn or erased, there is nothing left to take back. */
const FINAL = new Set(["withdrawn", "erased"])

/**
 * A submission's status, opened from its private tracking link or from the sender's own card. The link is the only
 * key to it: whoever holds it can see the status and withdraw the place, so the view says to keep it private.
 */
export function Tracking() {
  const tracking = useStore((s) => s.tracking)
  const setTracking = useStore((s) => s.setTracking)
  // undefined: loading or unreachable · null: no such submission for this link
  const [state, setState] = useState<{ key: string; result: Tracked | null | undefined; failed: boolean } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
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
  const link = tracking ? `${location.origin}/#/track/${encodeURIComponent(tracking.id)}/${encodeURIComponent(tracking.token)}` : ""

  const withdraw = async () => {
    if (!tracking) return
    setWorking(true)
    const done = await withdrawSubmission(tracking.id, tracking.token)
    setWorking(false)
    setConfirming(false)
    if (!done) return void toast("לא הצלחנו למשוך כרגע", { description: "ההצעה לא השתנתה. נסו שוב בעוד רגע." })
    setState({ key, result: { status: "withdrawn", name_he: null }, failed: false })
    // The sender's own copy on this device, if it is here, says so too.
    const own = useStore.getState().local.find((p) => p.local?.remoteId === tracking.id)
    if (own) void useStore.getState().updateLocal(own.id, { send: "withdrawn" })
  }

  return (
    <Dialog open={!!tracking} onOpenChange={(v) => !v && setTracking(null)}>
      <DialogContent dir="rtl" className="sm:max-w-[480px]">
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
              <p className="text-label text-ink-1">{STATUS[current.result.status] ?? current.result.status}</p>
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
                המקום, הסיפור והשם שלכם יימחקו מהשרת מיד, וגם אם המקום כבר פורסם הוא ירד מהאתר. אי אפשר לבטל את זה.
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
