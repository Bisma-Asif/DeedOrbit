/**
 * One campaign: its funnel, its intake door, and its management actions.
 *
 * The detail is the only staff surface that reveals the webhook token, because it
 * is the screen where an operator copies it onto a landing page. The metrics are
 * the reason the campaign exists, so they sit at the top rather than in a
 * footnote: leads, conversions to customers, bookings, and the rate.
 *
 * Archiving is soft — it deactivates intake but keeps the funnel — which is why
 * the button reads "Archive" and never "Delete".
 */

import { useState } from "react"

import { ArrowLeft, Megaphone, Pencil, Share2, Trash2 } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { Skeleton } from "@/components/ui/skeleton"

import { useSave } from "@/features/organization/use-save"

import { campaignsApi } from "@/lib/campaigns-api"

import { formatDate } from "@/lib/format"

import { navigate } from "@/lib/router"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { CampaignFormDialog } from "./campaign-form-dialog"

import { CampaignIntegrationDialog } from "./campaign-integration-dialog"

import { CAMPAIGN_CHANNELS, CAMPAIGN_CHANNEL_LABELS } from "@shared/campaigns"

interface CampaignDetailPageProps {
  campaignId: string
}

interface MetricTileProps {
  label: string
  value: number
}

function MetricTile({ label, value }: MetricTileProps) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  )
}

export function CampaignDetailPage({ campaignId }: CampaignDetailPageProps) {
  const session = useSession()

  const canView = session.can("campaigns", "view")

  const resource = useAsyncResource(
    (signal) => campaignsApi.read(campaignId, signal),

    canView,
  )

  const save = useSave()

  const [editing, setEditing] = useState(false)

  const [sharing, setSharing] = useState(false)

  const [confirmArchive, setConfirmArchive] = useState(false)

  if (!canView) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Campaign not available"
        description="Your role cannot read the campaigns module."
        tone="pending"
      />
    )
  }

  if (resource.loading && !resource.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  const campaign = resource.data?.campaign ?? null

  const integration = resource.data?.integration ?? null

  if (!campaign || !integration) {
    return (
      <EmptyState
        icon={Megaphone}
        title="That campaign does not exist"
        description="It may have been removed, or the link is wrong."
      />
    )
  }

  async function archive() {
    const done = await save.run(async () => {
      await campaignsApi.archive(campaign!.id)
    })

    if (done) {
      setConfirmArchive(false)

      await resource.reload()
    }
  }

  const canManage = campaign.canManage

  const actions = (
    <>
      <Button variant="ghost" size="sm" onClick={() => navigate("/campaigns")}>
        <ArrowLeft size={13} />
        Back
      </Button>

      <Button variant="outline" size="sm" onClick={() => setSharing(true)}>
        <Share2 size={13} />
        Intake &amp; token
      </Button>

      {canManage ? (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={13} />
            Edit
          </Button>

          {campaign.active ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600"
              onClick={() => setConfirmArchive(true)}
            >
              <Trash2 size={13} />
              Archive
            </Button>
          ) : null}
        </>
      ) : null}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={campaign.name}
        description={`Created by ${campaign.createdByName} · ${formatDate(campaign.createdAt)}`}
        actions={actions}
      />

      {save.error ? (
        <Alert variant="danger">
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      ) : null}

      {confirmArchive ? (
        <Alert variant="pending">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Archiving stops this intake link from accepting new leads. Its
              history and metrics are kept.
            </span>

            <span className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmArchive(false)}
              >
                Cancel
              </Button>

              <Button
                size="sm"
                variant="danger"
                onClick={() => void archive()}
                disabled={save.saving}
              >
                {save.saving ? "Archiving…" : "Confirm archive"}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile label="Leads" value={campaign.metrics.leads} />

        <MetricTile label="Converted" value={campaign.metrics.converted} />

        <MetricTile label="Bookings" value={campaign.metrics.bookings} />

        <MetricTile
          label="Active bkgs"
          value={campaign.metrics.activeBookings}
        />

        <MetricTile
          label="Lead→booking"
          value={campaign.metrics.leadToBookingRate}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Campaign</CardTitle>

            <CardDescription>
              The channel record and where its captured leads are stamped from.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3 py-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {resource.data?.channelLabels[campaign.channel] ??
                  CAMPAIGN_CHANNEL_LABELS[campaign.channel] ??
                  campaign.channel}
              </Badge>

              <Badge variant={campaign.active ? "success" : "outline"}>
                {campaign.active ? "Active" : "Archived"}
              </Badge>
            </div>

            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Lead source
                </dt>

                <dd className="mt-0.5 text-[13px] text-foreground">
                  {campaign.source}
                </dd>
              </div>

              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Intake path
                </dt>

                <dd className="mt-0.5 font-mono text-[12px] text-foreground">
                  {campaign.webhookPath}
                </dd>
              </div>
            </dl>

            {campaign.notes ? (
              <div className="border-t border-border pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Notes
                </p>

                <p className="mt-1 text-[13px] whitespace-pre-wrap text-foreground">
                  {campaign.notes}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Intake</CardTitle>

            <CardDescription>
              The public endpoint that captures leads into this campaign.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3 py-2">
            <p className="text-[12.5px] text-muted-foreground">
              {campaign.active
                ? "This campaign is accepting enquiries."
                : "This campaign is archived and no longer accepts enquiries."}
            </p>

            <Button
              variant="outline"
              onClick={() => setSharing(true)}
              className="w-full"
            >
              <Share2 size={13} />
              View endpoint, snippets &amp; token
            </Button>
          </CardContent>
        </Card>
      </div>

      <CampaignFormDialog
        open={editing}
        onOpenChange={setEditing}
        campaign={campaign}
        channels={CAMPAIGN_CHANNELS}
        channelLabels={resource.data?.channelLabels}
        onSaved={() => void resource.reload()}
      />

      <CampaignIntegrationDialog
        open={sharing}
        onOpenChange={setSharing}
        campaign={campaign}
        integration={integration}
        onRotated={() => void resource.reload()}
      />
    </div>
  )
}
