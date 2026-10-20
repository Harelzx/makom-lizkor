import { forwardRef, type ButtonHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type Variant = "approve" | "primary" | "outline" | "ghost" | "danger" | "danger-ghost"
const VARIANT: Record<Variant, string> = {
  approve: "bg-(--a-green) text-(--a-on-solid) hover:brightness-105 shadow-[0_1px_0_rgb(255_255_255/0.2)_inset]",
  primary: "bg-(--a-ink-1) text-(--a-panel) hover:opacity-90",
  outline: "border border-(--a-line-2) bg-(--a-panel) text-(--a-ink-1) hover:bg-(--a-panel-2)",
  ghost: "text-(--a-ink-2) hover:bg-(--a-sunk) hover:text-(--a-ink-1)",
  danger: "bg-(--a-red) text-(--a-on-solid) hover:brightness-105",
  "danger-ghost": "text-(--a-red-ink) hover:bg-(--a-red-soft)",
}
const SIZE = {
  sm: "h-9 gap-1.5 rounded-xl px-3 text-[0.875rem]",
  md: "h-11 gap-2 rounded-xl px-4 text-[0.9375rem]",
  lg: "h-12 gap-2.5 rounded-2xl px-5 text-[1rem]",
}

/** The page's one button: a size a finger can hit, a visible focus, and a press that gives a little. */
export const Btn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE }>(
  function Btn({ variant = "outline", size = "md", className, type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "a-focus-ring pressable inline-flex shrink-0 cursor-pointer items-center justify-center font-semibold whitespace-nowrap transition-[background-color,filter,opacity] duration-150 select-none disabled:pointer-events-none disabled:opacity-45",
          SIZE[size],
          VARIANT[variant],
          className,
        )}
        {...rest}
      />
    )
  },
)

/** Inputs in the page's own look, keeping native semantics (labels, required, dates). */
export const inputClass =
  "a-focus-ring w-full rounded-xl border border-(--a-line-2) bg-(--a-panel-2) px-3.5 text-[0.9375rem] text-(--a-ink-1) placeholder:text-(--a-ink-3) outline-none focus:border-(--a-ink-3)"
export const fieldLabel = "mb-1.5 block text-[0.875rem] font-semibold text-(--a-ink-1)"
export const fieldHint = "mt-1.5 block text-[0.8125rem] text-(--a-ink-3)"
export const checkClass = "mt-0.5 size-[1.125rem] shrink-0 accent-(--a-ink-1)"
