import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Marketing CTA button. Renders an anchor when `href` is set, otherwise a button.
 * Variants map straight onto the brand tokens: solid emerald for primary actions,
 * a hairline outline for secondary actions, and light/dark ghosts for use on the
 * slate bands. No gradients, no glow — the emerald carries the accent alone.
 */

interface MarketingButtonProps {
  children: ReactNode
  onClick?: () => void
  href?: string
  variant?: "primary" | "outline" | "outlineLight" | "ghost" | "ghostLight"
  size?: "md" | "lg"
  className?: string
  type?: "button" | "submit"
  disabled?: boolean
  ariaLabel?: string
}

const VARIANTS: Record<string, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm",
  outline:
    "border border-white/25 text-white hover:border-white/50 hover:bg-white/10",
  outlineLight:
    "border border-primary/40 text-primary hover:bg-primary/10",
  ghost: "text-white/85 hover:text-white hover:bg-white/10",
  ghostLight: "text-foreground/80 hover:text-foreground hover:bg-black/5",
}

const SIZES: Record<string, string> = {
  md: "h-10 px-4 text-[14px]",
  lg: "h-12 px-6 text-[15px]",
}

export function MarketingButton({
  children,
  onClick,
  href,
  variant = "primary",
  size = "md",
  className,
  type = "button",
  disabled,
  ariaLabel,
}: MarketingButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold tracking-tight",
    "transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
    "disabled:opacity-60 disabled:pointer-events-none",
    SIZES[size],
    VARIANTS[variant],
    className,
  )

  if (href) {
    return (
      <a href={href} className={classes} aria-label={ariaLabel}>
        {children}
      </a>
    )
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={classes}
    >
      {children}
    </button>
  )
}
