import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useReveal } from "@/features/marketing/hooks"

/**
 * Presentational primitives shared by every marketing section. Kept tiny and
 * dependency-free so the landing stays fast.
 */

export const SECTION_IDS = {
  features: "features",
  how: "how",
  pricing: "pricing",
  faq: "faq",
  contact: "contact",
} as const

/**
 * Smooth-scrolls to a section by DOM id. Used instead of `#anchor` hrefs because
 * the app's router owns the URL hash — a plain `#features` would be parsed as a
 * route. Reduced-motion visitors jump instantly instead of easing.
 */
export function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
}

interface ContainerProps {
  children: ReactNode
  className?: string
}

export function Container({ children, className }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl px-5 sm:px-8", className)}>
      {children}
    </div>
  )
}

interface RevealProps {
  children: ReactNode
  className?: string
  delay?: number
  as?: "div" | "li"
}

/** Fade + rise on first scroll into view; static under reduced motion. */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const { ref, visible } = useReveal()
  const style: CSSProperties = { transitionDelay: visible ? `${delay}ms` : "0ms" }
  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        "transition-all duration-700 ease-out motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  )
}

interface SectionProps {
  children: ReactNode
  id?: string
  className?: string
  /** Visual band: light off-white, deep slate, or warm sand. */
  band?: "light" | "dark" | "sand"
  bleed?: boolean
}

export function Section({
  children,
  id,
  className,
  band = "light",
  bleed = false,
}: SectionProps) {
  const bandClass =
    band === "dark"
      ? "bg-nav text-nav-foreground"
      : band === "sand"
        ? "bg-sand text-sand-foreground"
        : "bg-background text-foreground"
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20 py-16 sm:py-20 lg:py-24",
        bandClass,
        className,
      )}
    >
      {bleed ? children : <Container>{children}</Container>}
    </section>
  )
}

interface EyebrowProps {
  children: ReactNode
  dark?: boolean
}

export function Eyebrow({ children, dark = false }: EyebrowProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] uppercase",
        dark ? "text-emerald-300" : "text-primary",
      )}
    >
      <span
        className={cn(
          "h-px w-6",
          dark ? "bg-emerald-300/60" : "bg-primary/50",
        )}
      />
      {children}
    </span>
  )
}

interface HeadingProps {
  title: string
  lead?: string
  dark?: boolean
  center?: boolean
}

export function SectionHeading({ title, lead, dark, center }: HeadingProps) {
  return (
    <div className={cn(center && "mx-auto text-center", "max-w-3xl")}>
      <h2
        className={cn(
          "font-display text-3xl leading-tight font-semibold tracking-tight sm:text-4xl",
          dark ? "text-white" : "text-foreground",
        )}
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={cn(
            "mt-4 text-[15px] leading-6 sm:text-base",
            dark ? "text-nav-muted" : "text-muted-foreground",
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  )
}
