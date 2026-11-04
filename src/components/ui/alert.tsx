import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative flex w-full gap-2.5 rounded-md border px-3 py-2 text-[12.5px] leading-5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-px",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted/60 text-secondary-foreground",
        success: "border-success-border bg-success-subtle text-success",
        pending: "border-warning-border bg-warning-subtle text-warning",
        danger: "border-danger-border bg-danger-subtle text-danger",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"h5"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "h5"
  return (
    <Comp
      data-slot="alert-title"
      className={cn(
        "mb-0.5 font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  )
}

/**
 * `asChild` is available because several call sites need block content inside an
 * alert — a token plus a copy button, for example — and a `div` is invalid inside
 * the `p` this renders by default.
 */
function AlertDescription({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"p"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "p"
  return (
    <Comp
      data-slot="alert-description"
      className={cn("leading-5 [&_a]:underline", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
