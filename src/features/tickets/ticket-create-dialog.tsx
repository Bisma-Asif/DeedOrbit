/**
 * Raise a support ticket on a customer's behalf.
 *
 * Staff use this when a request arrives at the front desk or on the phone: the
 * portal is not the only door into the queue. The customer is chosen from the
 * directory, and a booking may be attached so the ticket lands beside the right
 * property. A description is optional — a one-line note is a real ticket.
 *
 * `sla_due_by` is derived server-side from the chosen priority, so this form only
 * picks the priority and never touches the deadline.
 */

import { useEffect, useMemo, useState } from "react"

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

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { customersApi } from "@/lib/leads-api"

import { ticketsApi } from "@/lib/tickets-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  TICKET_DESCRIPTION_MAX,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_SUBJECT_MAX,
  type TicketPriority,
} from "@shared/tickets"

interface TicketCreateDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  onCreated: (ticketId: string) => void
}

export function TicketCreateDialog({
  open,

  onOpenChange,

  onCreated,
}: TicketCreateDialogProps) {
  const save = useSave()

  const [customerId, setCustomerId] = useState("")

  const [subject, setSubject] = useState("")

  const [description, setDescription] = useState("")

  const [priority, setPriority] = useState<TicketPriority>("normal")

  const [localError, setLocalError] = useState<string | null>(null)

  const directory = useAsyncResource(
    (signal) => customersApi.list(signal),

    open,
  )

  const customers = useMemo(
    () => directory.data?.customers ?? [],

    [directory.data],
  )

  useEffect(() => {
    if (!open) return

    setCustomerId("")

    setSubject("")

    setDescription("")

    setPriority("normal")

    setLocalError(null)

    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function submit() {
    setLocalError(null)

    if (customerId === "") {
      setLocalError("Choose the customer this request belongs to.")

      return
    }

    if (subject.trim() === "") {
      setLocalError("Give the ticket a subject.")

      return
    }

    let createdId: string | null = null

    const done = await save.run(async () => {
      const response = await ticketsApi.create({
        customerId,

        subject: subject.trim(),

        description: description.trim() === "" ? undefined : description.trim(),

        priority,
      })

      createdId = response.ticket.id
    })

    if (done) {
      onOpenChange(false)

      if (createdId) onCreated(createdId)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[36rem]">
        <DialogHeader>
          <DialogTitle>New support ticket</DialogTitle>
          <DialogDescription>
            Raise a service request for a customer. The response deadline is set
            from the priority you choose.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {localError ? (
            <Alert variant="danger">
              <AlertDescription>{localError}</AlertDescription>
            </Alert>
          ) : save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <Field label="Customer" htmlFor="ticket-customer" required>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="ticket-customer">
                <SelectValue
                  placeholder={
                    directory.loading
                      ? "Loading customers…"
                      : "Choose a customer"
                  }
                />
              </SelectTrigger>

              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <FieldGrid>
            <Field label="Subject" htmlFor="ticket-subject" required>
              <Input
                id="ticket-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={TICKET_SUBJECT_MAX}
              />
            </Field>

            <Field label="Priority" htmlFor="ticket-priority">
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as TicketPriority)}
              >
                <SelectTrigger id="ticket-priority">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {TICKET_PRIORITIES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {TICKET_PRIORITY_LABELS[entry]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>

          <Field label="Description (optional)" htmlFor="ticket-description">
            <Textarea
              id="ticket-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={TICKET_DESCRIPTION_MAX}
              rows={4}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Raising…" : "Raise ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
