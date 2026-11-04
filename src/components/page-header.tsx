import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

type PageHeaderProps = {
  title: string
  description?: ReactNode
  /** Organisation + entity scope, rendered above the title. */
  scope?: ReactNode
  actions?: ReactNode
  /** Tabs that scope the page below the header (e.g. Overview | Payments). */
  tabs?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  scope,
  actions,
  tabs,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {scope && (
            <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              {scope}
            </div>
          )}
          <h1 className="text-[19px] leading-7 font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 max-w-2xl text-[12.5px] leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {tabs && <div className="mt-3">{tabs}</div>}
    </div>
  )
}
