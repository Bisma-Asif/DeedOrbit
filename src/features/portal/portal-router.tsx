/**
 * Chooses which portal page a path renders.
 *
 * The portal has four sections plus a request thread, and it lives entirely
 * under `/portal`. `App.tsx` hands any portal-role session here rather than to
 * the staff module registry, because a buyer should never resolve a staff
 * module — the sidebar nav and its route guard do not apply. An unknown or
 * malformed path falls back to the overview rather than a 404, since a mistyped
 * hash on a low-stakes surface is friendlier landing at home.
 */

import { PortalOverviewPage } from "./portal-overview-page"

import { PortalPaymentsPage } from "./portal-payments-page"

import { PortalDocumentsPage } from "./portal-documents-page"

import { PortalRequestsPage } from "./portal-requests-page"

import { PortalRequestDetailPage } from "./portal-request-detail-page"

/** A request id is a plain token, validated so a hand-typed path cannot smuggle one through. */

const REQUEST_ID = /^[A-Za-z0-9_-]+$/

export function PortalRouter({ path }: { path: string }) {
  const segments = path.split("/").filter(Boolean)

  // [0] is always "portal" for a portal session; anything else is the landing page.

  if (segments[0] !== "portal" || segments.length === 1) {
    return <PortalOverviewPage />
  }

  switch (segments[1]) {
    case "payments":
      return <PortalPaymentsPage />

    case "documents":
      return <PortalDocumentsPage />

    case "requests": {
      const id = segments[2]

      if (id && segments.length === 3 && REQUEST_ID.test(id)) {
        return (
          <PortalRequestDetailPage
            requestId={id}
            key={`portal-request-${id}`}
          />
        )
      }

      return <PortalRequestsPage />
    }

    default:
      return <PortalOverviewPage />
  }
}
