import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const iconTone = {
  neutral: "border-border bg-muted text-muted-foreground",
  pending: "border-warning-border bg-warning-subtle text-warning",
  danger: "border-danger-border bg-danger-subtle text-danger",
  positive: "border-success-border bg-success-subtle text-success",
} as const

export type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  tone?: keyof typeof iconTone
  size?: "sm" | "md"
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  size = "md",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center px-6 text-center",
        size === "md" ? "min-h-56 py-8" : "min-h-32 py-5",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-md border",
          size === "md" ? "size-9" : "size-7",
          iconTone[tone],
        )}
      >
        <Icon size={size === "md" ? 17 : 14} />
      </span>
      <p
        className={cn(
          "mt-3 font-medium text-foreground",
          size === "md" ? "text-[13px]" : "text-[12.5px]",
        )}
      >
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-sm text-[12px] leading-5 text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-3.5 flex items-center gap-2">{action}</div>}
    </div>
  )
}
