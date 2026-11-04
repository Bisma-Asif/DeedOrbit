import { useState } from "react"

import { Settings2 } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Skeleton } from "@/components/ui/skeleton"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { EmptyState } from "@/components/empty-state"

import { useSession } from "@/lib/session-context"

import type { OrganizationSettings } from "@/lib/organization-api"

import { NumberingPanel } from "./numbering-panel"

import { OfficesPanel } from "./offices-panel"

import { ProfileForm } from "./profile-form"

import {
  useBranches,
  useNumbering,
  useOrganizationSettings,
} from "./use-organization"

export type OrganizationSection = "profile" | "offices" | "numbering"

/**
 * Organization settings.
 *
 * The section is chosen by the page's single tab row rather than by a second
 * tab bar of its own: two identical strips stacked inside one another read as a
 * rendering fault, and no other screen in the product nests its navigation.
 *
 * Only the section in view is fetched, so opening Offices does not also pull the
 * numbering counters. Each child is gated on the matching view grant, and the
 * server re-checks every action regardless - these flags decide what to show,
 * never what is allowed.
 */
export function OrganizationPanel({
  section,
}: {
  section: OrganizationSection
}) {
  const session = useSession()

  const canView = session.can("settings", "view")

  const canEdit = session.can("settings", "edit")

  const settings = useOrganizationSettings(canView && section === "profile")

  const branches = useBranches(canView && section === "offices")

  const numbering = useNumbering(canView && section === "numbering")

  if (!canView) {
    return (
      <EmptyState
        icon={Settings2}
        title="Organization settings are not available to your role"
        description="Ask a workspace administrator for the settings grant to view this section."
        tone="pending"
      />
    )
  }

  if (section === "offices") {
    return <OfficesTab state={branches} />
  }

  if (section === "numbering") {
    return <NumberingTab state={numbering} />
  }

  return <ProfileTab state={settings} canEdit={canEdit} />
}

interface LoadErrorProps {
  error: string
  retry: () => void
}

function LoadError({ error, retry }: LoadErrorProps) {
  return (
    <Alert variant="danger">
      <AlertTitle>Could not load this section</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{error}</span>
        <button
          type="button"
          onClick={retry}
          className="shrink-0 text-[12px] font-medium underline underline-offset-2"
        >
          Try again
        </button>
      </AlertDescription>
    </Alert>
  )
}

function ProfileTab({
  state,
  canEdit,
}: {
  state: ReturnType<typeof useOrganizationSettings>
  canEdit: boolean
}) {
  // The save response already carries the whole settings object, so applying it
  // here avoids a second round-trip and keeps the form from flickering.
  const [justSaved, setJustSaved] = useState<OrganizationSettings | null>(null)

  if (state.error) {
    return <LoadError error={state.error} retry={() => void state.reload()} />
  }

  if (state.loading && !state.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registered details</CardTitle>
          <CardDescription>Loading organization profile</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </CardContent>
      </Card>
    )
  }

  if (!state.data) return null

  return (
    <ProfileForm
      settings={justSaved ?? state.data.settings}
      canEdit={canEdit}
      onSaved={(next) => {
        setJustSaved(next)

        void state.reload()
      }}
    />
  )
}

function OfficesTab({ state }: { state: ReturnType<typeof useBranches> }) {
  if (state.error) {
    return <LoadError error={state.error} retry={() => void state.reload()} />
  }

  if (state.loading && !state.data) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!state.data) return null

  return (
    <OfficesPanel
      branches={state.data.branches}
      canEdit={state.data.canEdit}
      onChanged={() => void state.reload()}
    />
  )
}

function NumberingTab({ state }: { state: ReturnType<typeof useNumbering> }) {
  if (state.error) {
    return <LoadError error={state.error} retry={() => void state.reload()} />
  }

  if (state.loading && !state.data) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }

  if (!state.data) return null

  return (
    <NumberingPanel
      formats={state.data.formats}
      fiscalYear={state.data.fiscalYear}
      fiscalYearStartsIn={state.data.fiscalYearStartsIn}
      canEdit={state.data.canEdit}
      onChanged={() => void state.reload()}
    />
  )
}
