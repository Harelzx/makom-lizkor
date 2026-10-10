import { useEffect, useState } from "react"
import { AlertCircleIcon, CheckIcon, Loader2Icon } from "lucide-react"
import { Anemone } from "@/components/anemone"
import { Button } from "@/components/ui/button"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useVisibleViewport } from "@/lib/use-visible-viewport"

export type SubmissionOutcome = {
  kind: "sent" | "temporary" | "rejected"
  description: string
  stored?: boolean
  retryAt?: number
  attemptNumber?: number
}

/** An acknowledgement stays until the visitor acts; even an instant response gets time to be read. */
export function SubmissionResult({
  result,
  busy,
  attemptNumber,
  onContinue,
  onRetry,
  onEdit,
  onClose,
}: {
  result: SubmissionOutcome
  busy: boolean
  attemptNumber: number
  onContinue: () => void
  onRetry: () => void
  onEdit: () => void
  onClose: () => void
}) {
  const visible = useVisibleViewport(true)
  const [now, setNow] = useState(Date.now)
  const remaining = Math.max(0, Math.ceil(((result.retryAt ?? 0) - now) / 1000))
  useEffect(() => {
    if (!result.retryAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [result.retryAt])
  const success = result.kind === "sent"
  return (
    <DialogContent
      dir="rtl"
      showCloseButton={false}
      data-submission-result
      style={{ maxHeight: visible.height * 0.92, top: visible.top + visible.height / 2 }}
      className="gap-5 overflow-y-auto p-6 text-center sm:max-w-[440px] sm:p-8"
      onEscapeKeyDown={(e) => busy && e.preventDefault()}
      onPointerDownOutside={(e) => e.preventDefault()}
    >
      <div className="mx-auto grid size-20 place-items-center" aria-hidden="true">
        {success ? <Anemone className="size-20" /> : <AlertCircleIcon className="size-12 text-ink-2" strokeWidth={1.3} />}
      </div>
      <DialogHeader className="gap-3">
        <DialogTitle className="text-title-3 font-extrabold text-ink-1">
          {success ? "תודה שהוספתם מקום לזכור" : result.kind === "rejected" ? "ההצעה לא התקבלה" : "לא הצלחנו לאשר את השליחה"}
        </DialogTitle>
        <DialogDescription className="text-body leading-relaxed text-ink-2">{result.description}</DialogDescription>
      </DialogHeader>
      {success && (
        <p className="flex items-center justify-center gap-2 text-label font-semibold text-ink-1">
          <CheckIcon className="size-4" />
          ההצעה התקבלה לבדיקה, עדיין לא פורסמה.
        </p>
      )}
      {!success && (
        <p role="status" aria-live="polite" aria-atomic="true" className="text-label font-semibold text-ink-1">
          {busy
            ? `שולחים לבדיקה - ניסיון ${attemptNumber}…`
            : result.kind === "rejected"
              ? `ניסיון ${result.attemptNumber ?? 1} הסתיים: ההצעה לא התקבלה.`
              : `ניסיון ${result.attemptNumber ?? 1} הסתיים ללא אישור קבלה.`}
        </p>
      )}
      {remaining > 0 && (
        <p className="text-caption text-ink-2">
          אפשר לנסות שוב בעוד {remaining < 60 ? `${remaining} שניות` : `${Math.ceil(remaining / 60)} דקות`}.
        </p>
      )}
      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <Button
          variant={success ? "brand" : "default"}
          className="min-h-12 rounded-full"
          disabled={busy || remaining > 0}
          onClick={success ? onContinue : result.kind === "temporary" ? onRetry : onEdit}
        >
          {busy && <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />}
          {busy ? "שולחים לבדיקה…" : success ? "לצפייה בהצעה" : result.kind === "temporary" ? "ניסיון שליחה נוסף" : "חזרה לטופס"}
        </Button>
        {!success && (
          <Button variant="ghost" className="min-h-11 rounded-full" disabled={busy} onClick={onClose}>
            סגירה ללא שמירה
          </Button>
        )}
      </div>
    </DialogContent>
  )
}
