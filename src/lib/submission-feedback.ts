export function submissionFeedback(kind: "sent" | "temporary" | "rejected", stored: boolean) {
  if (kind === "sent") return { title: "ההצעה נשלחה לבדיקה", button: "נשלחה לבדיקה", success: true }
  if (kind === "temporary")
    return {
      title: stored ? "ההצעה נשמרה במכשיר וממתינה לשליחה" : "לא הצלחנו לשלוח או לשמור",
      button: stored ? "ממתינה לשליחה" : "לא נשלחה",
      success: false,
    }
  return { title: "ההצעה לא התקבלה", button: "לא התקבלה", success: false }
}
