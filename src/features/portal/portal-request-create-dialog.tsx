/**
 * Raise a service request from the portal.
 *
 * The buyer's side of ticket intake: a subject, a description, a priority, and
 * (optionally) the property it concerns. The chosen booking must belong to one
 * of this login's own profiles — the server re-checks ownership, so a hand-typed
 * id from another account simply fails. The SLA clock starts on submit and the
 * request appears in the office queue as customer-raised.
 */

import { useState } from "react"

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

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { portalApi } from "@/lib/portal-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  TICKET_DESCRIPTION_MAX,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_SUBJECT_MAX,
  type TicketPriority,
} from "@shared/tickets"

interface PortalRequestCreateDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  onCreated: (requestId: string) => void
}

const NONE = "__none__"

export function PortalRequestCreateDialog({
  open,

  onOpenChange,

  onCreated,
}: PortalRequestCreateDialogProps) {
  const save = useSave()

  const properties = useAsyncResource(
    (signal) => portalApi.overview(signal),

    open,
  )

  const [subject, setSubject] = useState("")

  const [description, setDescription] = useState("")

  const [priority, setPriority] = useState<TicketPriority>("normal")

  const [bookingId, setBookingId] = useState<string>(NONE)

  function reset() {
    setSubject("")

    setDescription("")

    setPriority("normal")

    setBookingId(NONE)

    save.clear()
  }

  async function submit() {
    const created = await save.run(async () => {
      const result = await portalApi.createRequest({
        subject: subject.trim(),

        description: description.trim(),

        priority,

        bookingId: bookingId === NONE ? null : bookingId,
      })

      onCreated(result.requestId)
    })

    if (created) {
      reset()

      onOpenChange(false)
    }
  }

  const canSubmit =
    subject.trim() !== "" &&
    !save.saving &&
    description.trim().length <= TICKET_DESCRIPTION_MAX

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()

        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Raise a request</DialogTitle>
          <DialogDescription>
            Tell the office what you need. We respond within the promise shown
            for the priority you pick.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3.5">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            label="Subject"
            htmlFor="request-subject"
            required
            error={save.fields.subject}
          >
            <Input
              id="request-subject"
              value={subject}
              maxLength={TICKET_SUBJECT_MAX}
              placeholder="e.g. Question about my next instalment"
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>

          <Field
            label="Priority"
            htmlFor="request-priority"
            hint="Urgent means we aim to reply within 8 hours."
          >
            <Select
              value={priority}
              onValueChange={(value) => setPriority(value as TicketPriority)}
            >
              <SelectTrigger id="request-priority">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {TICKET_PRIORITIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {TICKET_PRIORITY_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Property"
            htmlFor="request-booking"
            hint="Optional — link the request to one of your purchases."
          >
            <Select value={bookingId} onValueChange={setBookingId}>
              <SelectTrigger id="request-booking">
                <SelectValue placeholder="No specific property" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value={NONE}>No specific property</SelectItem>

                {(properties.data?.properties ?? []).map((property) => (
                  <SelectItem
                    key={property.bookingId}
                    value={property.bookingId}
                  >
                    {property.projectName} · {property.unitCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Details"
            htmlFor="request-description"
            error={save.fields.description}
          >
            <Textarea
              id="request-description"
              value={description}
              maxLength={TICKET_DESCRIPTION_MAX}
              rows={5}
              placeholder="Describe what you need help with…"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {save.saving ? "Sending…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
