import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { formatMoneyFull, formatMoneyLakh } from "@/lib/format"

/**
 * Money rendered the South-Asian way the product speaks it — compact on the
 * face of the figure, exact on hover. A `null` metric is a dash, never a zero:
 * the server omits a figure it has no rows for, and inventing one would be a
 * lie on an owner's KPI card.
 */

export function MoneyText({
  value,

  currency,

  className,
}: {
  value: number | null | undefined

  currency: string

  className?: string
}) {
  if (value === null || value === undefined) {
    return <span className={cn("text-muted-foreground/45", className)}>—</span>
  }

  return (
    <span className={className} title={formatMoneyFull(value, currency)}>
      {formatMoneyLakh(value, currency)}
    </span>
  )
}

/** Plain grouped money for tables and rows, where the full figure is the point. */

export function MoneyExact({
  value,

  currency,

  className,
}: {
  value: number | null | undefined

  currency: string

  className?: string
}) {
  if (value === null || value === undefined) {
    return <span className={cn("text-muted-foreground/45", className)}>—</span>
  }

  return <span className={className}>{formatMoneyFull(value, currency)}</span>
}

/**
 * A clickable wrapper that keeps a card reading as one card. The tile is a real
 * button (keyboard and screen-reader reachable) rather than a div with a click
 * handler, and the accessible name comes from the caller.
 */

export function Clickable({
  to,

  label,

  children,

  className,
}: {
  to: string

  label: string

  children: ReactNode

  className?: string
}) {
  return (
    <a
      href={`#${to}`}
      aria-label={label}
      className={cn(
        "block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",

        className,
      )}
    >
      {children}
    </a>
  )
}
