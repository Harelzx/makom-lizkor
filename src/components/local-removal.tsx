import { useState } from "react"
import { Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useStore } from "@/store"
import type { Place } from "@/types"

export function LocalRemoval({ place }: { place: Place }) {
  const [open, setOpen] = useState(false)
  const local = place.local!
  const sent = !!local.remoteId && local.send !== "withdrawn"
  const uncertain = !!local.submitKey && (local.send === "waiting" || local.send === "sending")
  const remove = async () => {
    const result = await useStore.getState().removeLocal(place.id)
    const description = sent
      ? "ההצעה בשרת לא נמשכה. קישור המעקב הוסר מהמכשיר; אפשר לפנות אלינו אם תרצו למשוך אותה."
      : uncertain
        ? "ייתכן שההצעה כבר התקבלה בשרת; מחיקת העותק אינה מבטלת הצעה שהתקבלה."
        : undefined
    if (result === "kept")
      return void toast("העותק לא נמחק מהמכשיר", {
        description: "הוא הוסר מהרשימה כרגע, אך יחזור בביקור הבא. אם הוא ממתין לשליחה, הניסיון החוזר עדיין עשוי להישלח.",
      })
    if (result === "unknown")
      return void toast("לא ברור אם העותק נמחק מהמכשיר", {
        description: "אם הוא עדיין שמור, הוא יחזור בביקור הבא. אם הוא ממתין לשליחה, הניסיון החוזר עדיין עשוי להישלח.",
      })
    toast("העותק נמחק מהמכשיר", { description })
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="min-h-11 rounded-full whitespace-normal">
          <Trash2Icon className="size-4" />
          מחיקת העותק מהמכשיר
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>מחיקת העותק מהמכשיר?</AlertDialogTitle>
          <AlertDialogDescription>
            {sent
              ? "ההצעה שכבר נשלחה תישאר במערכת. גם קישור המעקב יימחק מהמכשיר. כדי למשוך את ההצעה, היכנסו למעקב לפני המחיקה."
              : uncertain
                ? "העותק המקומי יימחק. ייתכן שההצעה כבר הגיעה לשרת; מחיקה מכאן אינה מבטלת אותה שם."
                : "העותק יוסר מהמכשיר הזה. הפעולה אינה בקשה להסרת תוכן מהמפה הציבורית."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {local.remoteId && local.trackingToken && (
          <Button
            variant="secondary"
            className="min-h-11 rounded-full"
            onClick={() => {
              setOpen(false)
              useStore.getState().setTracking({ id: local.remoteId!, token: local.trackingToken! })
            }}
          >
            למעקב ולמשיכת ההצעה
          </Button>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">להשאיר את העותק</AlertDialogCancel>
          <AlertDialogAction variant="destructive" className="min-h-11" onClick={() => void remove()}>
            מחיקת העותק
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
