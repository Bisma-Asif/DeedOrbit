/**
 * Create or edit a campaign.
 *
 * A campaign is a named acquisition channel with a public intake door. Creating
 * one mints a webhook token server-side (surfaced on the detail screen, never
 * here); editing changes the name, channel, the `source` stamped on captured
 * leads, and whether it is still active.
 *
 * Leaving `source` blank makes the server stamp captured leads with the campaign
 * name, so the funnel reads consistently even when the operator does not fill it.
 */

import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Switch } from "@/components/ui/switch"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { campaignsApi, type CampaignWithMetrics } from "@/lib/campaigns-api"

import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_NAME_MAX,
  CAMPAIGN_NOTES_MAX,
  CAMPAIGN_SOURCE_MAX,
  type CampaignChannel,
} from "@shared/campaigns"

interface CampaignFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  /** Present in edit mode; blank otherwise. */

  campaign?: CampaignWithMetrics | null

  channels: readonly CampaignChannel[]

  channelLabels?: Record<CampaignChannel, string>

  onSaved: (campaignId?: string) => void
}

export function CampaignFormDialog({
  open,

  onOpenChange,

  campaign,

  channels,

  channelLabels,

  onSaved,
}: CampaignFormDialogProps) {
  const editing = Boolean(campaign)

  const save = useSave()

  const [name, setName] = useState("")

  const [channel, setChannel] = useState<CampaignChannel>("other")

  const [source, setSource] = useState("")

  const [notes, setNotes] = useState("")

  const [active, setActive] = useState(true)

  useEffect(() => {
    if (!open) return

    setName(campaign?.name ?? "")

    setChannel(campaign?.channel ?? "other")

    setSource(campaign?.source ?? "")

    setNotes(campaign?.notes ?? "")

    setActive(campaign?.active ?? true)

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign])

  async function submit() {
    if (name.trim() === "") return

    let createdId: string | undefined

    const done = await save.run(async () => {
      if (editing && campaign) {
        await campaignsApi.update(campaign.id, {
          name: name.trim(),

          channel,

          source: source.trim(),

          notes: notes.trim() === "" ? null : notes.trim(),

          active,
        })
      } else {
        const response = await campaignsApi.create({
          name: name.trim(),

          channel,

          source: source.trim() === "" ? undefined : source.trim(),

          notes: notes.trim() === "" ? undefined : notes.trim(),

          active,
        })

        createdId = response.campaignId
      }
    })

    if (done) {
      onOpenChange(false)

      onSaved(createdId)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[36rem]">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit campaign" : "New campaign"}
          </DialogTitle>

          <DialogDescription>
            {editing
              ? "Update this channel. Its intake token is unchanged."
              : "Name an acquisition channel. Creating it mints a private intake link for a landing page."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field label="Name" htmlFor="campaign-name" required>
            <Input
              id="campaign-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)

                save.clear()
              }}
              maxLength={CAMPAIGN_NAME_MAX}
            />
          </Field>

          <FieldGrid>
            <Field label="Channel" htmlFor="campaign-channel">
              <Select
                value={channel}
                onValueChange={(value) => setChannel(value as CampaignChannel)}
              >
                <SelectTrigger id="campaign-channel">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {channels.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {channelLabels?.[entry] ??
                        CAMPAIGN_CHANNEL_LABELS[entry] ??
                        entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Lead source (optional)"
              htmlFor="campaign-source"
              hint="Blank uses the campaign name."
            >
              <Input
                id="campaign-source"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value)

                  save.clear()
                }}
                maxLength={CAMPAIGN_SOURCE_MAX}
              />
            </Field>
          </FieldGrid>

          <Field label="Notes (optional)" htmlFor="campaign-notes">
            <Textarea
              id="campaign-notes"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value)

                save.clear()
              }}
              maxLength={CAMPAIGN_NOTES_MAX}
              rows={3}
            />
          </Field>

          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Switch
              checked={active}
              onCheckedChange={setActive}
              aria-label="Campaign active"
            />

            {active
              ? "Active — accepting enquiries"
              : "Inactive — intake link refused"}
          </label>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          <Button
            onClick={() => void submit()}
            disabled={save.saving || name.trim() === ""}
          >
            {save.saving
              ? "Saving…"
              : editing
                ? "Save changes"
                : "Create campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
