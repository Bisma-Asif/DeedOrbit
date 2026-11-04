/**
 * The create-booking form.
 *
 * A booking is the commitment itself, so the form asks only for what a commitment
 * needs: who the customer is, which unit, how much on what date, and the terms. The
 * sales channel — an internal agent, an external dealer, or a direct sale — is
 * optional and collapses to one of three choices, because who brought the buyer is a
 * fact about the deal, not a gate on making it.
 *
 * The form owns the create through `useSave`, so the server's field errors land
 * beside their controls, and it opens from three places at once: fresh from the
 * Bookings page, prefilled from a unit's quotation, or prefilled with a unit from the
 * inventory sheet. `prefill` carries whatever the caller already knows; the customer
 * is always chosen here, because a booking without a real customer is not a booking.
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

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { Field, FieldGrid } from "@/components/field"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { formatCurrency } from "@/lib/format"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { projectsApi } from "@/lib/projects-api"

import { projectInventoryApi } from "@/lib/project-inventory-api"

import { customersApi, type CustomerListItem } from "@/lib/leads-api"

import { salesAgentsApi } from "@/lib/sales-agents-api"

import { dealersApi } from "@/lib/dealers-api"

import {
  bookingsApi,
  type CreateBookingInput,
  type CreateBookingResponse,
} from "@/lib/bookings-api"

import {
  BOOKING_AMOUNT_MAX,
  BOOKING_NOTES_MAX,
  BOOKING_TERMS_MAX,
} from "@shared/bookings"

type Channel = "agent" | "dealer" | "direct"

/** Whatever the caller already knows when it opens the form. */

export interface BookingPrefill {
  projectId?: string

  unitId?: string

  unitCode?: string

  quoteId?: string

  bookingAmount?: number

  /**
   * Set when the source quotation named a lead: the customer still has to be chosen,
   * and the hint says why the lead is not simply filled in for them.
   */

  leadHint?: boolean
}

interface BookingFormDialogProps {
  open: boolean

  /** The tenant currency the amount is in, from whichever caller opened the form. */

  currency: string

  prefill?: BookingPrefill | null

  onClose: () => void

  /**
   * Receives the full create result so the caller can branch: a confirmed booking
   * navigates to it, whereas one held for approval (`pending`) goes to the queue
   * instead — there is no booking row to open yet.
   */
  onCreated: (result: CreateBookingResponse) => void
}

interface BookingFormState {
  projectId: string

  unitId: string

  customerId: string

  channel: Channel

  agentUserId: string

  dealerId: string

  bookingAmount: string

  bookingDate: string

  terms: string

  notes: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function emptyForm(prefill?: BookingPrefill | null): BookingFormState {
  return {
    projectId: prefill?.projectId ?? "",

    unitId: prefill?.unitId ?? "",

    customerId: "",

    channel: "direct",

    agentUserId: "",

    dealerId: "",

    bookingAmount:
      prefill?.bookingAmount !== undefined ? String(prefill.bookingAmount) : "",

    bookingDate: todayIso(),

    terms: "",

    notes: "",
  }
}

export function BookingFormDialog({
  open,

  currency,

  prefill,

  onClose,

  onCreated,
}: BookingFormDialogProps) {
  const { can } = useSession()

  const save = useSave()

  const [form, setForm] = useState<BookingFormState>(() => emptyForm(prefill))

  // Re-arm a fresh form every time the dialog opens, so a draft left on one unit or

  // one quotation cannot be carried onto the next by a fast click-through.

  useEffect(() => {
    if (open) {
      setForm(emptyForm(prefill))

      save.clear()
    }

    // A new prefill object per open is what we want to key on, not its identity.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.projectId, prefill?.unitId, prefill?.quoteId])

  const canReadProjects = can("projects", "view")

  const canReadInventory = can("inventory", "view")

  const canReadCustomers = can("customers", "view")

  const canReadAgents = can("sales_agents", "view")

  const canReadDealers = can("dealers", "view")

  const projects = useAsyncResource(
    (signal) => projectsApi.list(signal),

    open && canReadProjects,
  )

  const customers = useAsyncResource(
    (signal) => customersApi.list(signal),

    open && canReadCustomers,
  )

  // Units are scoped to the chosen project, so the request has to be re-issued

  // whenever that changes — `useAsyncResource` only re-runs on an `enabled` change,

  // hence the explicit reload keyed to the project.

  const units = useAsyncResource(
    (signal) => projectInventoryApi.list(form.projectId, signal),

    open && canReadInventory && form.projectId !== "",
  )

  const projectId = form.projectId

  useEffect(() => {
    if (open && canReadInventory && projectId !== "") void units.reload()

    // Only the project changing should re-fetch its units.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, open, canReadInventory])

  const agents = useAsyncResource(
    (signal) => salesAgentsApi.list(currentMonth(), signal),

    open && form.channel === "agent" && canReadAgents,
  )

  const dealers = useAsyncResource(
    (signal) => dealersApi.list(signal),

    open && form.channel === "dealer" && canReadDealers,
  )

  function patch(next: Partial<BookingFormState>) {
    setForm((current) => ({ ...current, ...next }))

    save.clear()
  }

  // Choosing a different project invalidates the unit chosen under the old one.

  function chooseProject(value: string) {
    setForm((current) => ({
      ...current,

      projectId: value,

      unitId: current.projectId === value ? current.unitId : "",
    }))

    save.clear()
  }

  const projectOptions = (projects.data?.projects ?? []).map((project) => ({
    id: project.id,

    name: project.name,
  }))

  const unitOptions = (units.data?.units ?? []).map((unit) => ({
    id: unit.id,

    unitCode: unit.unitCode,

    label: unit.unitType
      ? `${unit.unitCode} · ${unit.statusLabel}`
      : unit.unitCode,
  }))

  const customerOptions = (customers.data?.customers ?? []).map(
    (customer: CustomerListItem) => ({
      id: customer.id,

      primary: customer.name,

      secondary: customer.phone,
    }),
  )

  const agentOptions = (agents.data?.agents ?? []).map((agent) => ({
    id: agent.id,

    name: agent.name,
  }))

  const dealerOptions = (dealers.data?.dealers ?? []).map((dealer) => ({
    id: dealer.id,

    primary: dealer.companyName,

    secondary: dealer.contactName,
  }))

  const selectedUnit =
    unitOptions.find((unit) => unit.id === form.unitId) ?? null

  const amountNumber = Number(form.bookingAmount || 0)

  const errorFor = (key: string): string | undefined => save.fields[key]

  const channelGrantMissing =
    (form.channel === "agent" && !canReadAgents) ||
    (form.channel === "dealer" && !canReadDealers)

  async function submit() {
    const input: CreateBookingInput = {
      projectId: form.projectId,

      unitId: form.unitId,

      customerId: form.customerId,

      bookingAmount: amountNumber,

      bookingDate: form.bookingDate,

      terms: form.terms,

      ...(form.notes.trim() !== "" ? { notes: form.notes.trim() } : {}),

      ...(form.channel === "agent" && form.agentUserId
        ? { agentUserId: form.agentUserId }
        : {}),

      ...(form.channel === "dealer" && form.dealerId
        ? { dealerId: form.dealerId }
        : {}),

      ...(prefill?.quoteId ? { quoteId: prefill.quoteId } : {}),
    }

    const created = await save.run(async () => {
      const result = await bookingsApi.create(input)

      onCreated(result)
    })

    if (created) {
      save.clear()

      onClose()
    }
  }

  const money = useMemo(
    () => (value: number) =>
      formatCurrency(value, currency, { maximumFractionDigits: 0 }),

    [currency],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {prefill?.unitCode
              ? `New booking — ${prefill.unitCode}`
              : "New booking"}
          </DialogTitle>
          <DialogDescription>
            Commit a unit to a customer. Creating the booking moves the unit to
            Booked; a sales agent or dealer can be recorded, but neither is
            required.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="scrollbar-slim flex flex-col gap-4">
          {save.error && (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}

          {/* Subject: project + unit --------------------------------------- */}
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Unit being booked
            </legend>

            <FieldGrid>
              <Field
                label="Project"
                htmlFor="booking-project"
                required
                error={errorFor("projectId")}
              >
                <Select value={form.projectId} onValueChange={chooseProject}>
                  <SelectTrigger id="booking-project">
                    <SelectValue
                      placeholder={
                        projects.loading
                          ? "Loading…"
                          : projectOptions.length === 0
                            ? "No projects available"
                            : "Choose a project"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {projectOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="Unit"
                htmlFor="booking-unit"
                required
                error={errorFor("unitId")}
                hint={
                  form.projectId === ""
                    ? "Pick a project first."
                    : !canReadInventory
                      ? "Your role cannot read the unit list."
                      : undefined
                }
              >
                <Select
                  value={form.unitId}
                  onValueChange={(value) => patch({ unitId: value })}
                  disabled={
                    form.projectId === "" ||
                    !canReadInventory ||
                    units.loading ||
                    unitOptions.length === 0
                  }
                >
                  <SelectTrigger id="booking-unit">
                    <SelectValue
                      placeholder={
                        units.loading
                          ? "Loading…"
                          : unitOptions.length === 0
                            ? "No bookable units"
                            : "Choose a unit"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGrid>
          </fieldset>

          {/* Customer ----------------------------------------------------- */}
          <Field
            label="Customer"
            htmlFor="booking-customer"
            required
            error={errorFor("customerId")}
            hint={
              prefill?.leadHint
                ? "The quotation was addressed to a lead. Convert the lead to a customer first, then book."
                : !canReadCustomers
                  ? "Your role cannot read the customer list, so a booking cannot be made here."
                  : undefined
            }
          >
            <Select
              value={form.customerId}
              onValueChange={(value) => patch({ customerId: value })}
              disabled={
                !canReadCustomers ||
                customers.loading ||
                customerOptions.length === 0
              }
            >
              <SelectTrigger id="booking-customer">
                <SelectValue
                  placeholder={
                    customers.loading
                      ? "Loading…"
                      : customerOptions.length === 0
                        ? "No customers to choose yet"
                        : "Choose a customer"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {customerOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.primary}
                    <span className="ml-1.5 text-muted-foreground">
                      {option.secondary}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Channel ------------------------------------------------------ */}
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              Sales channel
            </legend>

            <div className="flex items-center gap-1.5 self-start rounded-md border border-border bg-muted/20 p-0.5">
              {([
                ["agent", "Agent"],

                ["dealer", "Dealer"],

                ["direct", "Direct"],
              ] as const)

                .map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={form.channel === value ? "default" : "ghost"}
                    className="h-6"
                    onClick={() => patch({ channel: value })}
                  >
                    {label}
                  </Button>
                ))}
            </div>

            {form.channel === "agent" && (
              <Field
                label="Sales agent"
                htmlFor="booking-agent"
                error={errorFor("agentUserId")}
                hint={
                  channelGrantMissing
                    ? "Your role cannot read the agent list."
                    : undefined
                }
              >
                <Select
                  value={form.agentUserId}
                  onValueChange={(value) => patch({ agentUserId: value })}
                  disabled={
                    !canReadAgents ||
                    agents.loading ||
                    agentOptions.length === 0
                  }
                >
                  <SelectTrigger id="booking-agent">
                    <SelectValue
                      placeholder={
                        agents.loading
                          ? "Loading…"
                          : agentOptions.length === 0
                            ? "No agents to choose yet"
                            : "Choose an agent"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {agentOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {form.channel === "dealer" && (
              <Field
                label="Dealer"
                htmlFor="booking-dealer"
                error={errorFor("dealerId")}
                hint={
                  channelGrantMissing
                    ? "Your role cannot read the dealer list."
                    : undefined
                }
              >
                <Select
                  value={form.dealerId}
                  onValueChange={(value) => patch({ dealerId: value })}
                  disabled={
                    !canReadDealers ||
                    dealers.loading ||
                    dealerOptions.length === 0
                  }
                >
                  <SelectTrigger id="booking-dealer">
                    <SelectValue
                      placeholder={
                        dealers.loading
                          ? "Loading…"
                          : dealerOptions.length === 0
                            ? "No dealers to choose yet"
                            : "Choose a dealer"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {dealerOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.primary}
                        <span className="ml-1.5 text-muted-foreground">
                          {option.secondary}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </fieldset>

          {/* Financials --------------------------------------------------- */}
          <FieldGrid>
            <Field
              label="Booking amount"
              htmlFor="booking-amount"
              required
              error={errorFor("bookingAmount")}
              hint={`Whole ${currency}, up to ${BOOKING_AMOUNT_MAX.toLocaleString("en-US")}.`}
            >
              <Input
                id="booking-amount"
                type="number"
                min={0}
                max={BOOKING_AMOUNT_MAX}
                step={1}
                inputMode="numeric"
                value={form.bookingAmount}
                onChange={(event) =>
                  patch({ bookingAmount: event.target.value })
                }
              />
            </Field>

            <Field
              label="Booking date"
              htmlFor="booking-date"
              required
              error={errorFor("bookingDate")}
            >
              <Input
                id="booking-date"
                type="date"
                value={form.bookingDate}
                onChange={(event) => patch({ bookingDate: event.target.value })}
              />
            </Field>
          </FieldGrid>

          <Field
            label="Terms"
            htmlFor="booking-terms"
            required
            error={errorFor("terms")}
            hint={`${form.terms.length}/${BOOKING_TERMS_MAX} characters.`}
          >
            <Textarea
              id="booking-terms"
              rows={3}
              maxLength={BOOKING_TERMS_MAX}
              value={form.terms}
              onChange={(event) => patch({ terms: event.target.value })}
              placeholder="Booking deposit, payment schedule, and any conditions agreed."
            />
          </Field>

          <Field
            label="Notes"
            htmlFor="booking-notes"
            error={errorFor("notes")}
          >
            <Textarea
              id="booking-notes"
              rows={2}
              maxLength={BOOKING_NOTES_MAX}
              value={form.notes}
              onChange={(event) => patch({ notes: event.target.value })}
              placeholder="Optional internal note."
            />
          </Field>

          {/* Live summary ------------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Booking summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3">
              <p className="text-muted-foreground">Unit</p>
              <p className="col-span-2 font-mono text-foreground tabular-nums">
                {selectedUnit?.unitCode ?? prefill?.unitCode ?? "—"}
              </p>
              <p className="text-muted-foreground">Customer</p>
              <p className="col-span-2 truncate text-foreground">
                {customerOptions.find((c) => c.id === form.customerId)
                  ?.primary ?? "—"}
              </p>
              <p className="text-muted-foreground">Channel</p>
              <p className="col-span-2 text-foreground capitalize">
                {form.channel === "agent"
                  ? (agentOptions.find((a) => a.id === form.agentUserId)
                      ?.name ?? "Agent")
                  : form.channel === "dealer"
                    ? (dealerOptions.find((d) => d.id === form.dealerId)
                        ?.primary ?? "Dealer")
                    : "Direct"}
              </p>
              <p className="text-muted-foreground">Amount</p>
              <p className="col-span-2 font-medium text-foreground tabular-nums">
                {form.bookingAmount ? money(amountNumber) : "—"}
              </p>
            </CardContent>
          </Card>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.saving}>
            {save.saving ? "Creating…" : "Create booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
