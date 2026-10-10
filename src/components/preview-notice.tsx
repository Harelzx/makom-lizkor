/** Shown only in the publicly viewable staging build. Private synthetic actions stay behind Access. */
export function PreviewNotice() {
  if (import.meta.env.VITE_PUBLIC_PREVIEW !== "true") return null
  return (
    <p className="rounded-2xl border border-line bg-surface-2 p-4 text-body text-ink-2">
      זו תצוגת ניסיון של האתר. צפייה ושיתוף פתוחים לכולם; שליחת הצעות ובקשות זמינה כרגע לבודקים לאחר{" "}
      <a href="/preview-login" className="font-semibold text-ink-1 underline underline-offset-4">
        כניסה לבדיקות
      </a>
      . אין צורך להיכנס כדי לעיין במפה.
    </p>
  )
}
