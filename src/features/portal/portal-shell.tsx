/**
 * The customer portal's application chrome.
 *
 * A logged-in `customer` never sees the staff `AppShell`: no sidebar, no tenant
 * switcher, no global search. This shell is a single top bar over a roomy,
 * centred content column — the same palette as the staff product but lower
 * density, because a buyer checks two or three things per visit rather than
 * working a queue all day.
 */

import type { ReactNode } from "react"

import { PortalNav } from "./portal-nav"

import type { SessionPayload } from "@/lib/api"

interface PortalShellProps {
  session: SessionPayload

  path: string

  onSignOut: () => void

  children: ReactNode
}

export function PortalShell({
  session,

  path,

  onSignOut,

  children,
}: PortalShellProps) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-nav focus:px-3 focus:py-1.5 focus:text-[12px] focus:font-medium focus:text-nav-foreground"
      >
        Skip to content
      </a>

      <PortalNav
        path={path}
        tenantName={session.tenant.name}
        userName={session.user.fullName}
        userEmail={session.user.email}
        onSignOut={onSignOut}
      />

      <main
        id="portal-main"
        className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-6 md:py-8"
      >
        {children}
      </main>

      <footer className="border-t border-border py-5">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-2 px-4 text-[11.5px] text-muted-foreground md:px-6">
          <p>{session.tenant.legalName ?? session.tenant.name}</p>
          <p className="tabular-nums">Signed in as {session.user.email}</p>
        </div>
      </footer>
    </div>
  )
}
