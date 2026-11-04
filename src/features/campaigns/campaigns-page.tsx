/**
 * The campaigns list.
 *
 * Every acquisition channel the workspace runs, with its funnel in the same row:
 * leads captured, how many became customers, how many of those hold a booking,
 * and the leads-to-bookings rate. The row links to the detail screen where the
 * intake token and integration snippets live.
 *
 * Metrics are read from the server's funnel join rather than recomputed here, so
 * a campaign never disagrees with the number the detail screen shows.
 */

import { useMemo, useState } from "react"

import { Megaphone, Plus } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card } from "@/components/ui/card"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
  type FilterOption,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { SavedViewControls } from "@/components/saved-view-controls"

import { Skeleton } from "@/components/ui/skeleton"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { campaignsApi, type CampaignWithMetrics } from "@/lib/campaigns-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { CampaignFormDialog } from "./campaign-form-dialog"

import {
  CAMPAIGN_CHANNEL_LABELS,
  type CampaignChannel,
} from "@shared/campaigns"

interface MetricProps {
  label: string
  value: number
}

function Metric({ label, value }: MetricProps) {
  return (
    <span className="tabular-nums text-foreground">
      {value}
      <span className="ml-1 text-[11px] text-muted-foreground">{label}</span>
    </span>
  )
}

export function CampaignsPage() {
  const session = useSession()

  const canView = session.can("campaigns", "view")

  const [creating, setCreating] = useState(false)

  const [filters, setFilters] = useState<Record<string, string>>({})

  const [resetToken, setResetToken] = useState(0)

  function applySavedView(state: string) {
    const parsed = JSON.parse(state) as Record<string, string>

    setFilters(parsed)

    setResetToken((token) => token + 1)
  }

  const resource = useAsyncResource(
    (signal) => campaignsApi.list(signal),

    canView,
  )

  const campaigns = resource.data?.campaigns ?? []

  const canCreate = resource.data?.canCreate ?? false

  const channels = resource.data?.channels ?? []

  const channelLabels = resource.data?.channelLabels

  const channelOptions: FilterOption[] = useMemo(
    () =>
      channels.map((channel) => ({
        value: channel,

        label:
          channelLabels?.[channel] ??
          CAMPAIGN_CHANNEL_LABELS[channel] ??
          channel,
      })),

    [channelLabels, channels],
  )

  const visibleCampaigns = useMemo(() => {
    const channel = filters.channel ?? ""

    const active = filters.active ?? ""

    return campaigns.filter((campaign) => {
      if (channel && campaign.channel !== channel) return false

      if (active && String(campaign.active) !== active) return false

      return true
    })
  }, [campaigns, filters])

  const columns = useMemo<Array<DataTableColumn<CampaignWithMetrics>>>(
    () => [
      {
        key: "name",

        header: "Campaign",

        sortValue: (row) => row.name,

        cell: (row) => (
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/campaigns/${row.id}`)}
              className="block max-w-full truncate text-left font-medium text-foreground hover:underline"
            >
              {row.name}
            </button>

            <p className="truncate text-[11.5px] text-muted-foreground">
              {row.source}
            </p>
          </div>
        ),
      },

      {
        key: "channel",

        header: "Channel",

        width: "10rem",

        sortValue: (row) => row.channel,

        cell: (row) => (
          <Badge variant="outline">
            {channelLabels?.[row.channel] ??
              CAMPAIGN_CHANNEL_LABELS[(row.channel as CampaignChannel)] ??
              row.channel}
          </Badge>
        ),
      },

      {
        key: "leads",

        header: "Leads",

        align: "right",

        width: "6rem",

        sortValue: (row) => row.metrics.leads,

        cell: (row) => (
          <span className="tabular-nums">{row.metrics.leads}</span>
        ),
      },

      {
        key: "converted",

        header: "Converted",

        align: "right",

        width: "6rem",

        sortValue: (row) => row.metrics.converted,

        cell: (row) => (
          <span className="tabular-nums">{row.metrics.converted}</span>
        ),
      },

      {
        key: "bookings",

        header: "Bookings",

        align: "right",

        width: "9rem",

        sortValue: (row) => row.metrics.bookings,

        cell: (row) => (
          <div className="flex justify-end gap-3">
            <Metric label="bkgs" value={row.metrics.bookings} />

            <Metric label="active" value={row.metrics.activeBookings} />
          </div>
        ),
      },

      {
        key: "rate",

        header: "Lead→booking",

        align: "right",

        width: "7rem",

        sortValue: (row) => row.metrics.leadToBookingRate,

        cell: (row) => (
          <span className="tabular-nums">{row.metrics.leadToBookingRate}%</span>
        ),
      },

      {
        key: "active",

        header: "Status",

        width: "7rem",

        sortValue: (row) => (row.active ? 0 : 1),

        cell: (row) => (
          <Badge variant={row.active ? "success" : "outline"}>
            {row.active ? "Active" : "Archived"}
          </Badge>
        ),
      },
    ],

    [channelLabels],
  )

  if (!canView) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Campaigns are not available to your role"
        description="Ask a workspace administrator for the campaigns grant to view this page."
        tone="pending"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Campaigns"
        description="Acquisition channels, their public intake links, and leads-to-bookings conversion."
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={14} />
              New campaign
            </Button>
          ) : null
        }
      />

      <Card className="p-0">
        {resource.error ? (
          <Alert variant="danger" className="m-3">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : resource.loading && !resource.data ? (
          <Skeleton className="m-3 h-40 w-auto" />
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="Create a channel to get a public intake link and start measuring conversion."
          />
        ) : (
          <DataTable<CampaignWithMetrics>
            columns={columns}
            rows={visibleCampaigns}
            rowKey={(row) => row.id}
            getRowSearchText={(row) => [row.name, row.source].join(" ")}
            initialSort={{ key: "name", direction: "asc" }}
            filters={filters}
            resetToken={resetToken}
            onFilterChange={(key, value) =>
              setFilters((current) => ({
                ...current,

                [key]: value === "__all" ? "" : value,
              }))
            }
            filterBar={
              <>
                <TableFilter
                  label="Channel"
                  value={filters.channel || "__all"}
                  placeholder="All channels"
                  options={channelOptions}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,

                      channel: value === "__all" ? "" : value,
                    }))
                  }
                />

                <TableFilter
                  label="Status"
                  value={filters.active || "__all"}
                  placeholder="Any status"
                  options={[
                    { value: "true", label: "Active" },
                    { value: "false", label: "Archived" },
                  ]}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,

                      active: value === "__all" ? "" : value,
                    }))
                  }
                />
              </>
            }
            toolbar={
              <SavedViewControls
                scope="campaigns"
                serialize={() => JSON.stringify(filters)}
                onApply={applySavedView}
              />
            }
            caption="Campaigns"
          />
        )}
      </Card>

      <CampaignFormDialog
        open={creating}
        onOpenChange={setCreating}
        channels={channels}
        channelLabels={channelLabels}
        onSaved={(campaignId) => {
          void resource.reload()

          if (campaignId) navigate(`/campaigns/${campaignId}`)
        }}
      />
    </div>
  )
}
