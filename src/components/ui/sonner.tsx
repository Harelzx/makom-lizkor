import { useStore } from "@/store"
import { createPortal } from "react-dom"
import { useVisibleViewport } from "@/lib/use-visible-viewport"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useStore((s) => (s.light === "night" ? "dark" : "light"))
  const visible = useVisibleViewport(true)

  // Drawers and dialogs are body portals. Keep notifications in the same layer,
  // outside App's fixed main stacking context, so their dismiss button is usable.
  return createPortal(
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      dir="rtl"
      duration={6500}
      closeButton
      visibleToasts={1}
      mobileOffset={{
        top: Math.max(16, visible.top + visible.height / 2 - 64),
        left: 24,
        right: 24,
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: "סגירת ההודעה",
        classNames: {
          toast: "cn-toast",
          closeButton: "cn-toast-close",
        },
      }}
      {...props}
    />,
    document.body
  )
}

export { Toaster }
