/**
 * The campaign intake integration.
 *
 * Everything an external landing page needs to post leads into this campaign:
 * the absolute endpoint (built server-side from the request origin), a paste-ready
 * HTML form, a `curl` example, and the secret token that gates the door.
 *
 * Rotation issues a fresh token and strands the old URL on purpose — a leaked
 * link is stopped by rotating, not by editing the campaign. The snippets come from
 * the server so the host in the sample always matches how the app is really being
 * reached, rather than a guessed origin.
 */

import { useState } from "react"

import { Check, Copy, RefreshCw } from "lucide-react"

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

import { useSave } from "@/features/organization/use-save"

import {
  campaignsApi,
  type CampaignDetail,
  type CampaignIntegration,
} from "@/lib/campaigns-api"

interface CampaignIntegrationDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  campaign: CampaignDetail

  integration: CampaignIntegration

  onRotated: () => void
}

interface CopyButtonProps {
  value: string
  label: string
}

function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={() => {
        void navigator.clipboard

          .writeText(value)

          .then(() => {
            setCopied(true)

            setTimeout(() => setCopied(false), 1500)
          })

          .catch(() => setCopied(false))
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {label}
    </Button>
  )
}

export function CampaignIntegrationDialog({
  open,

  onOpenChange,

  campaign,

  integration,

  onRotated,
}: CampaignIntegrationDialogProps) {
  const save = useSave()

  async function rotate() {
    const done = await save.run(async () => {
      await campaignsApi.rotateToken(campaign.id)
    })

    if (done) onRotated()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[42rem]">
        <DialogHeader>
          <DialogTitle>Lead intake</DialogTitle>

          <DialogDescription>
            Point a landing form at this endpoint to capture leads into{" "}
            {campaign.name}. The token in the URL is the only credential — treat
            it as a secret and rotate it if it leaks.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Endpoint
              </p>

              <CopyButton value={integration.endpoint} label="Copy" />
            </div>

            <code className="block overflow-x-auto rounded-md border border-border bg-muted/30 px-2.5 py-2 font-mono text-[11.5px] text-foreground">
              {integration.method} {integration.endpoint}
            </code>

            <p className="text-[11px] text-muted-foreground">
              Fields accepted: {integration.fields.join(", ")}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Webhook token
              </p>

              <CopyButton value={campaign.webhookToken} label="Copy" />
            </div>

            <code className="block overflow-x-auto rounded-md border border-border bg-muted/30 px-2.5 py-2 font-mono text-[12px] text-foreground">
              {campaign.webhookToken}
            </code>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Sample HTML form
              </p>

              <CopyButton value={integration.htmlSnippet} label="Copy" />
            </div>

            <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 px-2.5 py-2 font-mono text-[11px] whitespace-pre text-foreground">
              {integration.htmlSnippet}
            </pre>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                curl example
              </p>

              <CopyButton value={integration.curlSnippet} label="Copy" />
            </div>

            <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 px-2.5 py-2 font-mono text-[11px] whitespace-pre text-foreground">
              {integration.curlSnippet}
            </pre>
          </div>

          {campaign.canManage ? (
            <div className="flex items-center gap-2 border-t border-border pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void rotate()}
                disabled={save.saving}
              >
                <RefreshCw size={13} />
                {save.saving ? "Rotating…" : "Rotate token"}
              </Button>

              <p className="text-[11.5px] text-muted-foreground">
                A new URL is issued and the current one stops working.
              </p>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
