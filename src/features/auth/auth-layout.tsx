import type { ReactNode } from "react"
import { Building2, LockKeyhole, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { brand } from "@/config/brand"

/**
 * Shared chrome for every unauthenticated screen: form on the left, navy
 * product panel on the right. One layout so sign-in, sign-up, and password
 * recovery feel like the same product rather than three separate pages.
 */
export function AuthLayout({
  children,
  aside,
  footerNote,
}: {
  children: ReactNode
  aside?: ReactNode
  footerNote?: ReactNode
}) {
  return (
    <div className="grid min-h-dvh w-full bg-background lg:grid-cols-[minmax(420px,0.9fr)_1.1fr]">
      <section className="flex min-h-dvh flex-col border-border px-5 py-5 sm:px-8 lg:border-r lg:px-12">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-nav text-nav-foreground">
            <Building2 size={17} strokeWidth={2.2} />
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            {brand.name}
          </span>
        </div>

        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <LockKeyhole size={12} />
            {footerNote ?? "Session encrypted end to end"}
          </span>
          <span>{brand.copyright}</span>
        </div>
      </section>

      <aside className="hidden min-h-dvh flex-col justify-between bg-nav px-10 py-8 text-nav-foreground lg:flex xl:px-14">
        {aside ?? <DefaultAside />}
      </aside>
    </div>
  )
}

function DefaultAside() {
  return (
    <>
      <div>
        <p className="text-[10.5px] font-semibold tracking-[0.12em] text-nav-subtle uppercase">
          Back-office portal
        </p>
        <h2 className="mt-4 max-w-md text-[22px] leading-7 font-semibold tracking-tight">
          One workspace for the full sales and finance lifecycle.
        </h2>
        <p className="mt-3 max-w-md text-[13px] leading-6 text-nav-muted">
          Every module in the sidebar reads from the same ledger, so developers,
          sales, and finance always work from the same numbers.
        </p>
      </div>

      <dl className="mt-10 grid max-w-md grid-cols-2 gap-px overflow-hidden rounded-lg border border-nav-border bg-nav-border">
        {[
          ["Modules", "9 connected"],
          ["Entities", "Multi-entity"],
          ["Reporting", "Per project & entity"],
          ["Access", "Role-based"],
        ].map(([term, detail]) => (
          <div key={term} className="bg-nav px-4 py-3">
            <dt className="text-[10.5px] font-semibold tracking-[0.08em] text-nav-subtle uppercase">
              {term}
            </dt>
            <dd className="mt-1 text-[12.5px] font-medium text-nav-foreground">
              {detail}
            </dd>
          </div>
        ))}
      </dl>

      <div
        className={cn(
          "mt-10 flex items-center gap-2 text-[11.5px] text-nav-subtle",
        )}
      >
        <ShieldCheck size={13} /> Access is logged for audit and reviewed
        quarterly.
      </div>
    </>
  )
}

export function AuthHeading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mb-6">
      <h1 className="text-[19px] leading-7 font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <p className="mt-1.5 text-[12.5px] leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

/** Inline "already have an account" / "forgot password" style links. */
export function AuthLinkRow({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 text-[12px] text-muted-foreground">{children}</div>
  )
}
