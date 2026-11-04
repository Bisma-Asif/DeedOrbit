import { cloneElement, isValidElement, type ReactNode } from "react"
import { CircleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

export type FieldProps = {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string
  required?: boolean
  className?: string
  children: ReactNode
}

/**
 * Every form control in the product sits inside a Field: a real <label>, an
 * optional hint that doubles as the accessible description, and an inline error
 * region. Placeholder text is never used in place of a label.
 *
 * The a11y wiring (`aria-describedby`, `aria-invalid`) is injected into the
 * control, so callers cannot forget it.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined
  const errorId = error ? `${htmlFor}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined

  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        id: htmlFor,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true } : {}),
      })
    : children

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      <div
        className={cn(
          "[&_input]:w-full [&_textarea]:w-full",
          // Radix-based triggers are the only child that cannot fill on its own.
          "[&_[data-slot=select-trigger]]:w-full",
        )}
      >
        {control}
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-[11.5px] leading-4 font-medium text-danger"
        >
          <CircleAlert size={12} className="shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p
          id={hintId}
          className="text-[11.5px] leading-4 text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function FieldGrid({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
