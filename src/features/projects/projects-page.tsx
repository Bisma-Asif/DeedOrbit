import { useMemo, useState } from "react"
import { Building2, FolderKanban, Plus } from "lucide-react"
import type { NavItem } from "@/lib/navigation"
import { formatDate, formatNumber, orDash } from "@/lib/format"
import { projectsApi, type Project } from "@/lib/projects-api"
import { useAsyncResource } from "@/lib/use-async-resource"
import { navigate } from "@/lib/router"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DataTable,
  TableFilter,
  type DataTableColumn,
} from "@/components/data-table"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { CreateProjectDialog } from "@/features/projects/create-project-dialog"
import { ProjectStatusBadge } from "@/features/projects/project-status-badge"
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@shared/projects"

/**
 * The project list.
 *
 * Read-only for a member without `projects.create`: the "New project" button is
 * absent rather than disabled, because a control that cannot work should not be
 * offered. The same rule applies to the row click — every member who can reach
 * this page can open a project, so the whole row is the affordance.
 *
 * The unit column is headed "Planned units" on purpose. It is the figure the
 * developer states, not a count of inventory rows - the inventory table exists
 * now, and holds the units actually published against the structure - so a
 * column labelled "Units" would quietly change meaning the first time somebody
 * added one. A project that has not been sized shows a dash.
 */
export function ProjectsPage({ module }: { module: NavItem }) {
  const { data, loading, error, reload } = useAsyncResource((signal) =>
    projectsApi.list(signal),
  )

  const [creating, setCreating] = useState(false)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [resetToken, setResetToken] = useState(0)

  const projects = data?.projects ?? []

  const status = filters.status ?? ""

  // Filtering here rather than on the server keeps the count in the footer
  // honest and the response small enough that a workspace with a few hundred
  // projects never needs a second request.
  const rows = useMemo(
    () => (status ? projects.filter((p) => p.status === status) : projects),
    [projects, status],
  )

  const columns = useMemo<Array<DataTableColumn<Project>>>(
    () => [
      {
        key: "name",
        header: "Project",
        width: "18rem",
        sortValue: (row) => row.name,
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{row.name}</p>
            {row.developer ? (
              <p className="truncate text-[11.5px] text-muted-foreground">
                {row.developer}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "code",
        header: "Ref",
        width: "6rem",
        sortValue: (row) => row.code ?? "",
        cell: (row) =>
          row.code ? (
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {row.code}
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
      },
      {
        key: "location",
        header: "Location",
        width: "16rem",
        sortValue: (row) => row.location,
        cell: (row) => <span className="truncate">{orDash(row.location)}</span>,
      },
      {
        key: "status",
        header: "Status",
        width: "8rem",
        sortValue: (row) => row.status,
        cell: (row) => <ProjectStatusBadge status={row.status} />,
      },
      {
        key: "launchDate",
        header: "Launch",
        width: "7.5rem",
        sortValue: (row) => row.launchDate ?? "",
        cell: (row) =>
          row.launchDate ? (
            <span className="whitespace-nowrap tabular-nums">
              {formatDate(row.launchDate)}
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
      },
      {
        key: "plannedUnits",
        header: "Planned units",
        align: "right",
        width: "8rem",
        sortValue: (row) => row.plannedUnits ?? -1,
        cell: (row) => (
          <span className="tabular-nums">
            {row.plannedUnits === null ? (
              <span className="text-muted-foreground/60">—</span>
            ) : (
              formatNumber(row.plannedUnits)
            )}
          </span>
        ),
      },
    ],
    [],
  )

  const totals = data?.totals

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={module.label}
        description={module.description}
        actions={
          data?.canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={13} />
              {module.primaryAction}
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total projects"
          icon={FolderKanban}
          value={totals ? formatNumber(totals.total) : undefined}
          loading={loading}
        />
        <StatCard
          label="On sale"
          icon={Building2}
          value={totals ? formatNumber(totals.onSale) : undefined}
          hint="Open to buyers now"
          loading={loading}
        />
        <StatCard
          label="Launching soon"
          value={totals ? formatNumber(totals.launchingSoon) : undefined}
          hint="Pre-launch, dated within 90 days"
          loading={loading}
        />
        <StatCard
          label="Planned units"
          value={
            totals
              ? totals.plannedUnits === null
                ? undefined
                : formatNumber(totals.plannedUnits)
              : undefined
          }
          hint={
            totals && totals.plannedUnits === null
              ? "No project states a figure"
              : "Sum of stated plans, not inventory"
          }
          loading={loading}
        />
      </div>

      <Card>
        <DataTable<Project>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          getRowSearchText={(row) =>
            [row.name, row.developer, row.location, row.code ?? ""].join(" ")
          }
          initialSort={{ key: "name", direction: "asc" }}
          filters={filters}
          onFilterChange={(key, value) =>
            setFilters((current) => ({ ...current, [key]: value }))
          }
          resetToken={resetToken}
          loading={loading && !data}
          filterBar={
            <TableFilter
              label="Status"
              value={status || "__all"}
              placeholder="All"
              options={PROJECT_STATUSES.map((value) => ({
                value,
                label: PROJECT_STATUS_LABELS[value],
              }))}
              onValueChange={(value) => {
                setFilters((current) => ({
                  ...current,
                  status: value === "__all" ? "" : value,
                }))
                setResetToken((token) => token + 1)
              }}
            />
          }
          onRowClick={(row) => navigate(`/projects/${row.id}`)}
          maxHeight="max(18rem, calc(100dvh - 25rem))"
          emptyState={
            error ? (
              <EmptyState
                icon={FolderKanban}
                tone="danger"
                title="Could not load projects"
                description={error}
                action={
                  <Button variant="outline" onClick={() => void reload()}>
                    Try again
                  </Button>
                }
              />
            ) : status ? (
              <EmptyState
                icon={FolderKanban}
                size="sm"
                title="No projects with that status"
                description="Reset the filter to see the rest."
              />
            ) : (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description={
                  data?.canCreate
                    ? "Create a project to record who is developing it, where it is, and when it opens."
                    : "A project manager has not created a project in this workspace yet."
                }
                action={
                  data?.canCreate ? (
                    <Button onClick={() => setCreating(true)}>
                      <Plus size={13} />
                      New project
                    </Button>
                  ) : null
                }
              />
            )
          }
        />
      </Card>

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
