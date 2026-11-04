import { useState } from "react"

import { Database, TriangleAlert } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

import type { DashboardKpiKey, DashboardWidgetKey } from "@shared/dashboard"

import { dashboardApi } from "@/lib/dashboard-api"
import { useSession } from "@/lib/session-context"

import type { SessionUser, Tenant } from "@/lib/workspace"

import { ApprovalsCard } from "@/features/dashboard/approvals-card"
import {
  ActivityCard,
  RecentBookingsCard,
  TopAgentsCard,
} from "@/features/dashboard/bottom-row"
import { ChartsRow } from "@/features/dashboard/charts-row"
import { CategoryBreakdownCard } from "@/features/dashboard/category-breakdown-card"
import { DashboardHeader } from "@/features/dashboard/dashboard-header"
import { DocumentVerificationCard } from "@/features/dashboard/document-verification-card"
import { GetStartedCard } from "@/features/dashboard/get-started-card"
import { InstallmentsCard } from "@/features/dashboard/installments-card"
import { KpiRow } from "@/features/dashboard/kpi-row"
import { PersonalCard } from "@/features/dashboard/personal-card"
import { ProjectsSection } from "@/features/dashboard/projects-section"
import { QuickActions } from "@/features/dashboard/quick-actions"
import { RecoveryAgingCard } from "@/features/dashboard/recovery-aging-card"
import { useDashboard } from "@/features/dashboard/use-dashboard"

/** The tiles the first paint skeletons against, before the server answers. */
const PLACEHOLDER_KPIS: DashboardKpiKey[] = [
  "sales",
  "collections",
  "receivables",
  "overdue",
  "unitsSold",
  "inventory",
  "customers",
  "leads",
]

/** Likewise for sections: the owner-shaped layout while the role is unknown. */
const PLACEHOLDER_SECTIONS = [
  "kpiRow",
  "charts",
  "projects",
  "installmentsApprovals",
  "bottom",
  "quickActions",
]

const GRANULARITY_LABELS: Record<string, string> = {
  day: "day",

  week: "week",

  month: "month",
}

/**
 * The post-login command center.
 *
 * Layout, visibility and every figure on this page come from the server's
 * single aggregated answer: the response carries the role's visible widget
 * list, the KPI keys it may see, and the section order, so this component only
 * ever renders what it was told to render. Nothing here is a placeholder
 * number, and a metric with no rows arrives as `null` and renders a dash.
 */
export function DashboardPage({
  tenant,
  user,
}: {
  tenant: Tenant

  user: SessionUser
}) {
  const { can } = useSession()

  const dash = useDashboard()

  const [sampleBusy, setSampleBusy] = useState<"remove" | null>(null)

  const meta = dash.meta

  const currency = meta?.currency ?? "AED"

  const loadingFirstPaint = dash.loading && !dash.data

  const sections = meta ? dash.sections : PLACEHOLDER_SECTIONS

  const shows = (section: string) => sections.includes(section)

  const canSee = (widget: DashboardWidgetKey) =>
    !meta || dash.visible.includes(widget)

  const kpiKeys = meta ? dash.kpiKeys : PLACEHOLDER_KPIS

  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name

  async function removeSample() {
    setSampleBusy("remove")

    try {
      await dashboardApi.removeSample()

      dash.reload()
    } finally {
      setSampleBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardHeader
        tenant={tenant}
        firstName={firstName}
        meta={meta}
        range={dash.filters.range}
        customFrom={dash.filters.from ?? ""}
        customTo={dash.filters.to ?? ""}
        projectId={dash.filters.projectId ?? null}
        onRangeChange={dash.setRange}
        onCustomFromChange={dash.setCustomFrom}
        onCustomToChange={dash.setCustomTo}
        onProjectChange={dash.setProjectId}
        onRefresh={dash.reload}
        refreshing={dash.loading}
      />

      {dash.error && (
        <Alert variant="danger">
          <TriangleAlert size={14} aria-hidden />

          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span className="flex-1">{dash.error}</span>

            <Button variant="outline" size="sm" onClick={dash.reload}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {meta?.sampleActive && (
        <Alert variant="pending">
          <Database size={14} aria-hidden />

          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span className="flex-1">
              Demo dataset loaded — these rows are flagged as sample data and
              are kept apart from your live business.
            </span>

            {meta.canManageSample && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void removeSample()}
                disabled={sampleBusy !== null}
              >
                {sampleBusy === "remove" ? "Removing…" : "Remove sample data"}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {shows("quickActions") && (
        <QuickActions
          can={(module, action) => can(module, action)}
          className={
            loadingFirstPaint ? "pointer-events-none opacity-70" : undefined
          }
        />
      )}

      {meta && !meta.hasAnyData && (
        <GetStartedCard
          state={dash.widget("checklist")}
          sampleActive={meta.sampleActive}
          canManageSample={meta.canManageSample}
          onChange={dash.reload}
        />
      )}

      {shows("kpiRow") &&
        (canSee("personal") ? (
          <PersonalCard state={dash.widget("personal")} currency={currency} />
        ) : kpiKeys.length > 0 ? (
          <KpiRow
            state={dash.widget("kpis")}
            kpiKeys={kpiKeys}
            currency={currency}
            range={meta?.range ?? "month"}
            hasData={meta?.hasAnyData !== false}
          />
        ) : null)}

      {shows("charts") && (
        <>
          <ChartsRow
            trendState={dash.widget("trend")}
            inventoryState={dash.widget("inventory")}
            showTrend={canSee("trend")}
            showInventory={canSee("inventory")}
            currency={currency}
            granularityLabel={
              GRANULARITY_LABELS[meta?.granularity ?? "month"] ?? "period"
            }
            hasProjects={(meta?.projectOptions.length ?? 0) > 0}
          />

          {/* The property-type mix reads the workspace's own category lists and is
              scoped by the project filter, so it is remounted when the scope changes
              rather than showing last project's counts. */}
          {canSee("inventory") && can("inventory", "view") && (
            <CategoryBreakdownCard
              key={dash.filters.projectId ?? "all"}
              projectId={dash.filters.projectId ?? null}
              currency={currency}
            />
          )}
        </>
      )}

      {shows("projects") && canSee("projects") && (
        <ProjectsSection state={dash.widget("projects")} currency={currency} />
      )}

      {meta?.hasAnyData && can("documents", "view") && (
        <DocumentVerificationCard state={dash.widget("documentVerification")} />
      )}

      {shows("installmentsApprovals") && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {canSee("installments") && (
            <InstallmentsCard
              state={dash.widget("installments")}
              currency={currency}
              today={meta?.today ?? ""}
            />
          )}

          {canSee("approvals") && (
            <ApprovalsCard state={dash.widget("approvals")} />
          )}
        </div>
      )}

      {shows("aging") && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <RecoveryAgingCard />

          {canSee("installments") === false && (
            <InstallmentsCard
              state={dash.widget("installments")}
              currency={currency}
              today={meta?.today ?? ""}
            />
          )}
        </div>
      )}

      {shows("bottom") && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          {canSee("recentBookings") && (
            <RecentBookingsCard
              state={dash.widget("recentBookings")}
              currency={currency}
            />
          )}

          {canSee("agents") && (
            <TopAgentsCard state={dash.widget("agents")} currency={currency} />
          )}

          {canSee("activity") && (
            <ActivityCard state={dash.widget("activity")} />
          )}
        </div>
      )}
    </div>
  )
}
