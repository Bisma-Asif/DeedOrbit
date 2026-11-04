/**
 * Booking payment plans: read a schedule, confirm a plan, record a payment.
 *
 * The arithmetic lives in `shared/payment-plan-schedule.ts` — the same function the
 * client's live preview calls — so a confirmed plan's rows are byte-for-byte the lines
 * the builder showed. Confirming is the only write that creates rows, and it is a
 * single transaction: the plan and its whole generated schedule commit together, so a
 * stored plan never exists without the installments it promised.
 *
 * A plan cannot be replaced once confirmed, and a line cannot be paid beyond its
 * balance. Both refusals are the same instinct the booking and quotation trails
 * already follow: the honest history is append-only, and a mistake is corrected by a
 * fresh record rather than by editing the one that was relied upon.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  HttpError,
  type RequestContext,
} from "../http.ts"

import {
  requireAuth,
  requirePermission,
  writeAudit,
  type GuardedContext,
} from "../middleware.ts"

import { bookingOwnerUserIds, notifyRecipients } from "../notify.ts"

// The tenant's own day, currency and country: `server/tenant-locale.ts` is the single
// read of them, shared with the customer and collection routes.

import { tenantCurrency, tenantToday } from "../tenant-locale.ts"

import { emitEvent } from "../webhooks.ts"

import { sendPaymentReceivedConfirmation } from "../jobs/payment-reminders.ts"

import {
  BALLOON_MAX,
  BALLOON_MIN,
  CUSTOM_INTERVAL_DAYS_MAX,
  CUSTOM_INTERVAL_DAYS_MIN,
  DOWN_PAYMENT_PERCENT_MAX,
  DOWN_PAYMENT_PERCENT_MIN,
  INSTALLMENT_MAX,
  INSTALLMENT_MIN,
  PLAN_CHARGES_MAX,
  PLAN_NET_MAX,
  PLAN_NOTES_MAX,
  isFrequency,
  type Frequency,
  type InstallmentDisplayStatus,
  type InstallmentKind,
  type InstallmentStatus,
} from "../../shared/payment-plans.ts"

import {
  buildPaymentSchedule,
  type PaymentPlanConfig,
} from "../../shared/payment-plan-schedule.ts"

import { readBookingRow } from "./bookings.ts"

import {
  approvedDocOverrideExists,
  documentsGateState,
} from "../document-verification-core.ts"

import { insertApproval } from "./approvals.ts"

import type { DocumentOverrideApprovalPayload } from "../../shared/approvals.ts"

import { readUnitFacts } from "../unit-facts.ts"

import { nextDocumentNumber } from "./organization.ts"

import {
  appendLedgerEntry,
  bookingReferenceMap,
  readCustomerLedger,
} from "../ledger.ts"

import {
  PAYMENT_AMOUNT_MAX,
  PAYMENT_NOTE_MAX,
  isPaymentMethod,
  type PaymentAllocationInput,
  type PaymentMethod,
} from "../../shared/payments.ts"

import type { LedgerEntry } from "../../shared/ledger.ts"

interface PaymentRow {
  id: string

  tenant_id: string

  customer_id: string

  booking_id: string | null

  currency: string

  method: string

  amount: number

  receipt_number: string | null

  note: string | null

  recorded_by_user_id: string

  recorded_by_name: string

  received_at: string

  created_at: string
}

const now = () => new Date().toISOString()

interface PlanRow {
  id: string

  tenant_id: string

  booking_id: string

  currency: string

  net_amount: number

  down_payment_percent: number

  charges: number

  frequency: string

  custom_interval_days: number | null

  installment_count: number

  balloon_amount: number

  start_date: string

  status: string

  notes: string | null

  created_by_user_id: string

  created_by_name: string

  created_at: string

  confirmed_at: string
}

interface InstallmentRow {
  id: string

  tenant_id: string

  plan_id: string

  booking_id: string

  number: number

  kind: string

  due_date: string

  amount: number

  charges: number

  total: number

  paid_amount: number

  status: string
}

interface AllocationBookingRow {
  id: string

  customer_id: string
}

function toPlan(row: PlanRow) {
  return {
    id: row.id,

    bookingId: row.booking_id,

    currency: row.currency,

    netAmount: row.net_amount,

    downPaymentPercent: row.down_payment_percent,

    charges: row.charges,

    frequency: row.frequency as Frequency,

    customIntervalDays: row.custom_interval_days,

    installmentCount: row.installment_count,

    balloonAmount: row.balloon_amount,

    startDate: row.start_date,

    status: row.status,

    notes: row.notes,

    createdByUserId: row.created_by_user_id,

    createdByName: row.created_by_name,

    createdAt: row.created_at,

    confirmedAt: row.confirmed_at,
  }
}

/**
 * The time-relative reading, derived at read time from recorded money and today.
 *
 * Never stored, because "overdue" is a fact about the calendar rather than the row and
 * would go stale the moment the day turned without anyone touching it. Money decides
 * paid and partially paid; the due date against the tenant's own day decides the rest.
 */

function deriveDisplayStatus(
  installment: InstallmentRow,

  today: string,
): InstallmentDisplayStatus {
  if (installment.total > 0 && installment.paid_amount >= installment.total) {
    return "paid"
  }

  if (installment.paid_amount > 0) return "partially_paid"

  if (installment.due_date < today) return "overdue"

  if (installment.due_date === today) return "due"

  return "upcoming"
}

function toInstallment(row: InstallmentRow, today: string) {
  return {
    id: row.id,

    planId: row.plan_id,

    bookingId: row.booking_id,

    number: row.number,

    kind: row.kind as InstallmentKind,

    dueDate: row.due_date,

    amount: row.amount,

    charges: row.charges,

    total: row.total,

    paidAmount: row.paid_amount,

    status: row.status as InstallmentStatus,

    displayStatus: deriveDisplayStatus(row, today),
  }
}

// --- Tenant clock and currency --------------------------------------------
//
// `tenantCurrency`, `tenantToday` and `tenantCountryCode` live in
// `server/tenant-locale.ts`, which the customer and collection routes read the same way.

function readPlanWithInstallments(
  tenantId: string,
  planId: string,
  today: string,
) {
  const installments = all<InstallmentRow>(
    `SELECT * FROM payment_installments
      WHERE tenant_id = ? AND plan_id = ?
      ORDER BY number ASC`,

    tenantId,

    planId,
  )

  return installments.map((row) => toInstallment(row, today))
}

// --- Read ------------------------------------------------------------------

/** GET /api/bookings/:id/payment-plan */

export async function getBookingPaymentPlan(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const bookingId = ctx.params.id

  // Confirms the booking exists and belongs to this tenant before reading its plan.

  const booking = readBookingRow(guarded.tenantId, bookingId)

  const today = tenantToday(guarded.tenantId)

  const facts = readUnitFacts(
    guarded.tenantId,

    booking.project_id,

    booking.unit_id,
  )

  // A lump-sum-only unit has no schedule to build, so the builder is not offered at all
  // rather than offered and refused: the flag that hides the button is the same one the
  // confirm route checks below.
  const allowsInstallments = facts?.allowsInstallments ?? true

  const plan = get<PlanRow>(
    `SELECT * FROM payment_plans WHERE tenant_id = ? AND booking_id = ?`,

    guarded.tenantId,

    bookingId,
  )

  return {
    plan: plan ? toPlan(plan) : null,

    installments: plan
      ? readPlanWithInstallments(guarded.tenantId, plan.id, today)
      : [],

    currency: tenantCurrency(guarded.tenantId),

    canCreate: guarded.can("payments", "create") && allowsInstallments,

    canRecord: guarded.can("payments", "edit"),

    allowsInstallments,

    saleMode: facts?.saleMode ?? null,
  }
}

// --- Confirm ---------------------------------------------------------------

/** One validated plan body, ready to generate a schedule from. Named so oxfmt cannot
 *  collapse an inline multi-member type literal. */

interface PlanDraft {
  netAmount: number

  downPaymentPercent: number

  charges: number

  frequency: Frequency

  customIntervalDays: number | null

  installmentCount: number

  balloonAmount: number

  startDate: string

  notes: string | null
}

function readBoundedInt(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  ) {
    return value
  }

  return null
}

/**
 * POST /api/bookings/:id/payment-plan/confirm — persist a plan and its generated rows.
 *
 * The booking must be confirmed (a held or cancelled booking gets no schedule), and no
 * plan may already exist for it. The schedule is produced by the shared builder, so
 * what lands in `payment_installments` is exactly what the preview promised, and the
 * whole thing — plan and every dated line — writes in one transaction.
 */

export async function confirmPaymentPlan(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "create")

  const bookingId = ctx.params.id

  const booking = readBookingRow(guarded.tenantId, bookingId)

  if (booking.status !== "confirmed") {
    throw conflict("Only a confirmed booking can carry a payment plan.")
  }

  // "If the unit is marked Lump Sum, skip the payment plan" enforced where the rows are
  // written, not only in the dialog that offers them: a plan on a lump-sum unit would put
  // installment dues against a customer who owes none, and the collection board would
  // chase money this workspace never agreed to take.
  const facts = readUnitFacts(
    guarded.tenantId,

    booking.project_id,

    booking.unit_id,
  )

  if (facts && !facts.allowsInstallments) {
    throw conflict(
      `${facts.unitCode} is sold ${facts.saleMode ?? "lump sum"} only, so no payment plan applies to this booking.`,
    )
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const netAmount = readBoundedInt(body.netAmount, 0, PLAN_NET_MAX)

  if (netAmount === null) {
    errors.netAmount = `Enter a whole number from 0 to ${PLAN_NET_MAX}.`
  }

  const downPaymentPercent = readBoundedInt(
    body.downPaymentPercent,

    DOWN_PAYMENT_PERCENT_MIN,

    DOWN_PAYMENT_PERCENT_MAX,
  )

  if (downPaymentPercent === null) {
    errors.downPaymentPercent = `Enter a whole percentage from ${DOWN_PAYMENT_PERCENT_MIN} to ${DOWN_PAYMENT_PERCENT_MAX}.`
  }

  const charges = readBoundedInt(body.charges, 0, PLAN_CHARGES_MAX)

  if (charges === null) {
    errors.charges = `Enter a whole number from 0 to ${PLAN_CHARGES_MAX}.`
  }

  const frequency: Frequency | null = isFrequency(body.frequency)
    ? body.frequency as Frequency
    : null

  if (frequency === null) errors.frequency = "Choose a payment frequency."

  const installmentCount = readBoundedInt(
    body.installmentCount,

    INSTALLMENT_MIN,

    INSTALLMENT_MAX,
  )

  if (installmentCount === null) {
    errors.installmentCount = `Enter a whole number from ${INSTALLMENT_MIN} to ${INSTALLMENT_MAX}.`
  }

  const balloonAmount = readBoundedInt(
    body.balloonAmount,
    BALLOON_MIN,
    BALLOON_MAX,
  )

  if (balloonAmount === null) {
    errors.balloonAmount = `Enter a whole number from ${BALLOON_MIN} to ${BALLOON_MAX}.`
  }

  // A custom interval is required only for the custom frequency; the fixed

  // frequencies derive their step from the calendar and must not carry a stray value.

  let customIntervalDays: number | null = null

  if (frequency === "custom") {
    customIntervalDays = readBoundedInt(
      body.customIntervalDays,

      CUSTOM_INTERVAL_DAYS_MIN,

      CUSTOM_INTERVAL_DAYS_MAX,
    )

    if (customIntervalDays === null) {
      errors.customIntervalDays = `Enter a whole number of days from ${CUSTOM_INTERVAL_DAYS_MIN} to ${CUSTOM_INTERVAL_DAYS_MAX}.`
    }
  }

  const startDate =
    typeof body.startDate === "string" ? body.startDate.trim() : ""

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    errors.startDate = "Enter the first due date as YYYY-MM-DD."
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim()
      : null

  if (notes !== null && notes.length > PLAN_NOTES_MAX) {
    errors.notes = `Use ${PLAN_NOTES_MAX} characters or fewer.`
  }

  // A down payment and a balloon cannot together more than cover the net amount, or the

  // financed figure the installments split would go negative — the one cross-field rule

  // the individual bounds cannot see.

  if (
    netAmount !== null &&
    downPaymentPercent !== null &&
    balloonAmount !== null
  ) {
    const downPayment = Math.round((netAmount * downPaymentPercent) / 100)

    if (downPayment + balloonAmount > netAmount) {
      errors.balloonAmount =
        "The down payment and balloon together exceed the net amount."
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  if (
    get<{ id: string }>(
      `SELECT id FROM payment_plans WHERE tenant_id = ? AND booking_id = ?`,

      guarded.tenantId,

      bookingId,
    )
  ) {
    throw conflict("This booking already has a confirmed payment plan.")
  }

  // --- Document verification block rule (plan activation) ------------------
  // A tenant may require the documents be verified before a schedule is confirmed,
  // independently of the booking gate. The same customer-scoped override approval
  // releases it; with the setting off (the default) nothing changes here.
  const docGate = documentsGateState(
    guarded.tenantId,

    booking.customer_id,

    "plan_activation",

    tenantToday(guarded.tenantId),
  )

  if (
    docGate.applies &&
    !docGate.ok &&
    !approvedDocOverrideExists(guarded.tenantId, booking.customer_id)
  ) {
    if (body.overrideDocBlock === true) {
      if (!docGate.allowOverride) {
        throw conflict(
          "This workspace does not allow document overrides for payment plans.",
        )
      }

      const reason =
        typeof body.overrideReason === "string"
          ? body.overrideReason.trim()
          : ""

      if (reason === "") {
        throw badRequest("Give a reason for the override.", {
          overrideReason: "Required.",
        })
      }

      const customerType =
        get<{ customer_type: string | null }>(
          "SELECT customer_type FROM customers WHERE tenant_id = ? AND id = ?",

          guarded.tenantId,

          booking.customer_id,
        )?.customer_type ?? "individual"

      const override: DocumentOverrideApprovalPayload = {
        gate: "plan_activation",

        projectId: booking.project_id,

        unitId: booking.unit_id,

        customerId: booking.customer_id,

        customerType,

        agentUserId: booking.agent_user_id,

        bookingId: bookingId,

        planId: null,

        missingKeys: docGate.missingKeys,

        reason,
      }

      const approval = insertApproval({
        tenantId: guarded.tenantId,

        actionKey: "document_booking_override",

        summary: `Document override for ${booking.customer_name} — payment plan (missing: ${docGate.missingLabels.join(", ")})`,

        payload: override,

        entityType: "customer",

        resultEntityId: booking.customer_id,

        requestedByUserId: guarded.userId,

        requestedByName: guarded.session.user.fullName,
      })

      writeAudit(
        guarded,

        "payment.plan.override_requested",

        "approval",

        approval.id,

        { bookingId, missingKeys: docGate.missingKeys, reason },

        ctx.ip,
      )

      return {
        approval,

        pending: true,

        blockedByDocuments: docGate.missingLabels,
      }
    }

    throw new HttpError(
      409,

      "documents_required",

      `This customer still needs documents before a payment plan: ${docGate.missingLabels.join(", ")}.`,

      {
        missingDocuments: docGate.missingLabels.join(", "),

        missingKeys: docGate.missingKeys.join(", "),

        overrideAllowed: String(docGate.allowOverride),
      },
    )
  }

  const draft: PlanDraft = {
    netAmount: netAmount as number,

    downPaymentPercent: downPaymentPercent as number,

    charges: charges as number,

    frequency: frequency as Frequency,

    customIntervalDays,

    installmentCount: installmentCount as number,

    balloonAmount: balloonAmount as number,

    startDate,

    notes,
  }

  const today = tenantToday(guarded.tenantId)

  const plan = transaction(() => insertPlan(guarded, bookingId, draft))

  writeAudit(
    guarded,

    "payment.plan.confirmed",

    "payment_plan",

    plan.id,

    { bookingId, netAmount: draft.netAmount, charges: draft.charges },

    ctx.ip,
  )

  return {
    plan: toPlan(plan),

    installments: readPlanWithInstallments(guarded.tenantId, plan.id, today),

    currency: tenantCurrency(guarded.tenantId),

    canCreate: false,

    canRecord: guarded.can("payments", "edit"),

    allowsInstallments: true,

    saleMode: facts?.saleMode ?? null,
  }
}

/**
 * Writes the plan and every generated installment. Runs inside the caller's
 * transaction. The schedule is built by the shared function so the stored lines match
 * the client preview exactly, and the plan is credited to whoever confirms it.
 */

function insertPlan(
  guarded: GuardedContext,

  bookingId: string,

  draft: PlanDraft,
): PlanRow {
  const id = `plan_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  const config: PaymentPlanConfig = {
    netAmount: draft.netAmount,

    downPaymentPercent: draft.downPaymentPercent,

    charges: draft.charges,

    frequency: draft.frequency,

    customIntervalDays: draft.customIntervalDays,

    installmentCount: draft.installmentCount,

    balloonAmount: draft.balloonAmount,

    startDate: draft.startDate,
  }

  run(
    `INSERT INTO payment_plans (
        id, tenant_id, booking_id, currency, net_amount, down_payment_percent,
        charges, frequency, custom_interval_days, installment_count, balloon_amount,
        start_date, status, notes, created_by_user_id, created_by_name, created_at,
        confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    bookingId,

    tenantCurrency(guarded.tenantId),

    draft.netAmount,

    draft.downPaymentPercent,

    draft.charges,

    draft.frequency,

    draft.customIntervalDays,

    draft.installmentCount,

    draft.balloonAmount,

    draft.startDate,

    draft.notes,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    stamp,
  )

  for (const line of buildPaymentSchedule(config)) {
    const installmentId = `inst_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

    run(
      `INSERT INTO payment_installments (
          id, tenant_id, plan_id, booking_id, number, kind, due_date, amount,
          charges, total, paid_amount, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'scheduled')`,

      installmentId,

      guarded.tenantId,

      id,

      bookingId,

      line.number,

      line.kind,

      line.dueDate,

      line.amount,

      line.charges,

      line.total,
    )
  }

  const plan = get<PlanRow>(`SELECT * FROM payment_plans WHERE id = ?`, id)

  if (!plan) throw notFound("The payment plan could not be recorded")

  return plan
}

// --- Record a payment ------------------------------------------------------

/** The block that prints above a receipt, drawn from the workspace's organization profile. */
interface TenantBlockRow {
  name: string

  legal_name: string | null

  registration_number: string | null

  address_line1: string | null

  address_line2: string | null

  city: string | null

  state_region: string | null

  postal_code: string | null

  country_code: string | null

  phone: string | null

  collections_email: string | null
}

function readTenantBlock(tenantId: string) {
  const row = get<TenantBlockRow>(
    `SELECT name, legal_name, registration_number, address_line1, address_line2,
            city, state_region, postal_code, country_code, phone, collections_email
      FROM tenants WHERE id = ?`,
    tenantId,
  )

  return {
    name: row?.name ?? "",
    legalName: row?.legal_name ?? null,
    registrationNumber: row?.registration_number ?? null,
    addressLine1: row?.address_line1 ?? null,
    addressLine2: row?.address_line2 ?? null,
    city: row?.city ?? null,
    stateRegion: row?.state_region ?? null,
    postalCode: row?.postal_code ?? null,
    countryCode: row?.country_code ?? null,
    phone: row?.phone ?? null,
    email: row?.collections_email ?? null,
  }
}

function toPayment(row: PaymentRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    bookingId: row.booking_id,
    currency: row.currency,
    method: row.method as PaymentMethod,
    amount: row.amount,
    receiptNumber: row.receipt_number,
    note: row.note,
    recordedByUserId: row.recorded_by_user_id,
    recordedByName: row.recorded_by_name,
    receivedAt: row.received_at,
    createdAt: row.created_at,
  }
}

/** A validated record-payment body, ready to write inside a transaction. Named so oxfmt
 *  cannot collapse the inline multi-member literal. */
interface RecordPaymentInput {
  customerId: string

  method: PaymentMethod

  amount: number

  allocations: PaymentAllocationInput[]

  receivedAt: string

  note: string | null

  bookingId: string | null
}

interface RecordPaymentResult {
  payment: PaymentRow

  installments: InstallmentRow[]

  ledgerEntry: LedgerEntry
}

/** The ledger row just written, re-read with its running balance folded in. */
function findLedgerEntry(
  tenantId: string,
  customerId: string,
  entryId: string,
): LedgerEntry {
  const entries = readCustomerLedger(
    tenantId,
    customerId,
    bookingReferenceMap(tenantId, customerId),
  )

  const found = entries.find((entry) => entry.id === entryId)

  if (!found) throw notFound("The ledger entry could not be read")

  return found
}

/**
 * Writes one payment across its allocations. Runs inside the caller's transaction.
 *
 * The whole thing is atomic: the header, every allocation line, each installment's
 * bumped `paid_amount` and stored status, the per-line `installment_payments` trail, and
 * the single ledger debit all commit together or none of it does. Every allocation is
 * validated against its line's remaining balance before anything is written, so one bad
 * line rejects the whole payment rather than leaving a partial receipt. Paying a line whose
 * due date is still ahead is an advance and is allowed; only exceeding a balance is refused.
 */
function recordPaymentWithinTransaction(
  guarded: GuardedContext,
  input: RecordPaymentInput,
): RecordPaymentResult {
  const customer = get<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    input.customerId,
  )

  if (!customer) throw notFound("That customer does not exist")

  if (input.allocations.length === 0) {
    throw badRequest("Check the highlighted fields", {
      allocations: "Allocate the payment across at least one installment.",
    })
  }

  const currency = tenantCurrency(guarded.tenantId)

  interface PreparedLine {
    installment: InstallmentRow

    amount: number

    bookingId: string
  }

  const prepared: PreparedLine[] = []

  const bookingIds = new Set<string>()

  let allocatedSum = 0

  for (const allocation of input.allocations) {
    if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
      throw badRequest("Check the highlighted fields", {
        allocations: "Each allocation must be a positive whole number.",
      })
    }

    const installment = get<InstallmentRow>(
      `SELECT * FROM payment_installments WHERE tenant_id = ? AND id = ?`,
      guarded.tenantId,
      allocation.installmentId,
    )

    if (!installment) throw notFound("That installment does not exist")

    const booking = get<AllocationBookingRow>(
      `SELECT id, customer_id FROM bookings WHERE tenant_id = ? AND id = ?`,
      guarded.tenantId,
      installment.booking_id,
    )

    if (!booking || booking.customer_id !== input.customerId) {
      throw badRequest("Check the highlighted fields", {
        allocations: "That installment is not on this customer's schedule.",
      })
    }

    const remaining = installment.total - installment.paid_amount

    if (allocation.amount > remaining) {
      throw badRequest("Check the highlighted fields", {
        allocations:
          "A payment exceeds the remaining balance on one of the installments.",
      })
    }

    allocatedSum += allocation.amount

    bookingIds.add(booking.id)

    prepared.push({
      installment,
      amount: allocation.amount,
      bookingId: booking.id,
    })
  }

  if (allocatedSum !== input.amount) {
    throw badRequest("Check the highlighted fields", {
      amount: "The allocation total must equal the payment amount.",
    })
  }

  const headerBookingId =
    input.bookingId ?? (bookingIds.size === 1 ? [...bookingIds][0] : null)

  const receiptNumber = nextDocumentNumber(guarded.tenantId, "receipt")

  const paymentId = `pay_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  run(
    `INSERT INTO payments (
        id, tenant_id, customer_id, booking_id, currency, method, amount,
        receipt_number, note, recorded_by_user_id, recorded_by_name, received_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    paymentId,
    guarded.tenantId,
    input.customerId,
    headerBookingId,
    currency,
    input.method,
    input.amount,
    receiptNumber,
    input.note,
    guarded.userId,
    guarded.session.user.fullName,
    input.receivedAt,
    now(),
  )

  const updatedInstallments: InstallmentRow[] = []

  for (const line of prepared) {
    const allocationId = `alloc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

    run(
      `INSERT INTO payment_allocations (
          id, tenant_id, payment_id, installment_id, amount, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      allocationId,
      guarded.tenantId,
      paymentId,
      line.installment.id,
      line.amount,
      now(),
    )

    const installmentPaymentId = `ip_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

    run(
      `INSERT INTO installment_payments (
          id, tenant_id, installment_id, amount, paid_at, recorded_by_user_id,
          recorded_by_name, payment_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      installmentPaymentId,
      guarded.tenantId,
      line.installment.id,
      line.amount,
      input.receivedAt,
      guarded.userId,
      guarded.session.user.fullName,
      paymentId,
    )

    const paidAmount = line.installment.paid_amount + line.amount

    const status: InstallmentStatus =
      paidAmount >= line.installment.total ? "paid" : "partially_paid"

    run(
      `UPDATE payment_installments SET paid_amount = ?, status = ?
        WHERE tenant_id = ? AND id = ?`,
      paidAmount,
      status,
      guarded.tenantId,
      line.installment.id,
    )

    const row = get<InstallmentRow>(
      `SELECT * FROM payment_installments WHERE tenant_id = ? AND id = ?`,
      guarded.tenantId,
      line.installment.id,
    )

    if (row) updatedInstallments.push(row)
  }

  const ledgerEntryId = appendLedgerEntry({
    tenantId: guarded.tenantId,
    customerId: input.customerId,
    kind: "payment",
    amount: -input.amount,
    currency,
    occurredAt: input.receivedAt,
    recordedByUserId: guarded.userId,
    recordedByName: guarded.session.user.fullName,
    bookingId: headerBookingId,
    reference: receiptNumber,
    sourceType: "payment",
    sourceId: paymentId,
    note: input.note,
  })

  const payment = get<PaymentRow>(
    `SELECT * FROM payments WHERE id = ?`,
    paymentId,
  )

  if (!payment) throw notFound("The payment could not be recorded")

  const ledgerEntry = findLedgerEntry(
    guarded.tenantId,
    input.customerId,
    ledgerEntryId,
  )

  return { payment, installments: updatedInstallments, ledgerEntry }
}

/**
 * POST /api/payments — record one payment and allocate it across a customer's schedule.
 *
 * Cash, bank, or online; a positive whole amount split over one or more installments. The
 * allocation total must equal the payment amount, no line may be paid beyond its balance,
 * and paying a not-yet-due line is a legal advance. Minting the receipt number and writing
 * the ledger debit happen in the same transaction, so a payment always carries both.
 */
export async function recordPayment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const customerId =
    typeof body.customerId === "string" ? body.customerId.trim() : ""

  if (!customerId) errors.customerId = "Choose a customer."

  if (!isPaymentMethod(body.method)) {
    errors.method = "Choose how the payment was made."
  }

  const amount = readBoundedInt(body.amount, 1, PAYMENT_AMOUNT_MAX)

  if (amount === null) {
    errors.amount = `Enter a whole number from 1 to ${PAYMENT_AMOUNT_MAX}.`
  }

  const rawAllocations = Array.isArray(body.allocations) ? body.allocations : []

  const allocations: PaymentAllocationInput[] = []

  if (rawAllocations.length === 0) {
    errors.allocations = "Allocate the payment across at least one installment."
  }

  for (const entry of rawAllocations) {
    const record = (entry ?? {}) as Record<string, unknown>

    const installmentId =
      typeof record.installmentId === "string"
        ? record.installmentId.trim()
        : ""

    const lineAmount = typeof record.amount === "number" ? record.amount : NaN

    if (
      !installmentId ||
      !Number.isSafeInteger(lineAmount) ||
      lineAmount <= 0
    ) {
      errors.allocations =
        "Every allocation needs an installment and a positive whole amount."
      break
    }

    allocations.push({ installmentId, amount: lineAmount })
  }

  const bookingId =
    typeof body.bookingId === "string" && body.bookingId.trim() !== ""
      ? body.bookingId.trim()
      : null

  const receivedAt =
    typeof body.receivedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.receivedAt.trim())
      ? body.receivedAt.trim()
      : now()

  let note: string | null = null

  if (typeof body.note === "string" && body.note.trim() !== "") {
    note = body.note.trim()

    if (note.length > PAYMENT_NOTE_MAX) {
      errors.note = `Use ${PAYMENT_NOTE_MAX} characters or fewer.`
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const result = transaction(() =>
    recordPaymentWithinTransaction(guarded, {
      customerId,
      method: body.method as PaymentMethod,
      amount: amount as number,
      allocations,
      receivedAt,
      note,
      bookingId,
    }),
  )

  writeAudit(
    guarded,
    "payment.recorded",
    "payment",
    result.payment.id,
    {
      customerId,
      amount,
      receiptNumber: result.payment.receipt_number,
      allocations: allocations.length,
    },
    ctx.ip,
  )

  // The booking's owning agent hears that money landed on their sale; the officer
  // who recorded it does not need to be told about their own keystroke. A payment
  // not tied to a booking has no owner to notify, and nothing is invented.
  notifyRecipients(
    guarded.tenantId,
    bookingOwnerUserIds(guarded.tenantId, bookingId),
    {
      type: "payment_recorded",
      title: `Payment recorded: ${result.payment.receipt_number}`,
      body: `Receipt ${result.payment.receipt_number} for ${amount}`,
      linkPath: bookingId ? `/bookings/${bookingId}` : "/payments",
      actorUserId: guarded.userId,
      actorName: guarded.session.user.fullName,
    },
  )

  // Fire after the ledger write committed; the delivery log owns the outcome.
  void emitEvent(guarded.tenantId, "payment_received", {
    event: "payment_received",
    paymentId: result.payment.id,
    receiptNumber: result.payment.receipt_number,
    customerId,
    bookingId,
    amount,
    currency: result.payment.currency,
    receivedAt: result.payment.received_at,
  })

  // The customer's own thank-you, queued and dispatched off-ledger after the
  // payment committed. Fire-and-forget like the webhook above: a slow mail socket
  // must never delay the receipt response, and the engine swallows its own errors
  // into the outbound ledger. Opt-in, quiet hours, and a missing address are
  // honoured there as honest skipped rows, not as silence.
  void sendPaymentReceivedConfirmation(guarded.tenantId, result.payment.id)

  return { payment: toPayment(result.payment), ledgerEntry: result.ledgerEntry }
}

/**
 * GET /api/customers/:id/open-installments — the allocation dialog's source.
 *
 * Every installment across the customer's confirmed bookings that still carries a balance,
 * with the remaining amount, the derived display reading, and the booking reference so the
 * dialog can label each line. Not-yet-due lines are included: they are payable as advances.
 */
export async function listCustomerOpenInstallments(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const customerId = ctx.params.id

  const customer = get<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    customerId,
  )

  if (!customer) throw notFound("That customer does not exist")

  const today = tenantToday(guarded.tenantId)

  interface OpenRow extends InstallmentRow {
    booking_reference: string
  }

  const rows = all<OpenRow>(
    `SELECT i.*, b.reference AS booking_reference
      FROM payment_installments i
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      WHERE i.tenant_id = ? AND b.customer_id = ? AND b.status = 'confirmed'
        AND i.total - i.paid_amount > 0
      ORDER BY i.due_date ASC, i.number ASC`,
    guarded.tenantId,
    customerId,
  )

  return {
    installments: rows.map((row) => ({
      ...toInstallment(row, today),
      remaining: row.total - row.paid_amount,
      bookingReference: row.booking_reference,
    })),

    currency: tenantCurrency(guarded.tenantId),

    canRecord:
      guarded.can("payments", "create") || guarded.can("payments", "edit"),
  }
}

/** GET /api/payments?customerId= — the recent receipts, newest first. */
export async function listPayments(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const customerId = ctx.query.get("customerId")?.trim() || null

  interface PaymentListRow extends PaymentRow {
    customer_name: string | null
  }

  const rows = customerId
    ? all<PaymentListRow>(
        `SELECT p.*, c.full_name AS customer_name
          FROM payments p
          LEFT JOIN customers c ON c.id = p.customer_id AND c.tenant_id = p.tenant_id
          WHERE p.tenant_id = ? AND p.customer_id = ?
          ORDER BY p.received_at DESC, p.created_at DESC
          LIMIT 200`,
        guarded.tenantId,
        customerId,
      )
    : all<PaymentListRow>(
        `SELECT p.*, c.full_name AS customer_name
          FROM payments p
          LEFT JOIN customers c ON c.id = p.customer_id AND c.tenant_id = p.tenant_id
          WHERE p.tenant_id = ?
          ORDER BY p.received_at DESC, p.created_at DESC
          LIMIT 200`,
        guarded.tenantId,
      )

  return {
    payments: rows.map((row) => ({
      ...toPayment(row),
      customerName: row.customer_name,
    })),

    currency: tenantCurrency(guarded.tenantId),

    canCreate: guarded.can("payments", "create"),
  }
}

/**
 * GET /api/payments/:id — the printable receipt.
 *
 * The header, the allocated lines (booking reference, installment number, due date, and the
 * amount that landed on each), the customer block, and the tenant block the document prints
 * above the fold. Every field the receipt sheet needs arrives in one read so the print view
 * is faithful to the stored record.
 */
export async function readPaymentReceipt(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const paymentId = ctx.params.id

  const payment = get<PaymentRow>(
    `SELECT * FROM payments WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    paymentId,
  )

  if (!payment) throw notFound("That payment does not exist")

  const today = tenantToday(guarded.tenantId)

  interface AllocationRow {
    allocated: number

    installment_id: string

    number: number

    kind: string

    due_date: string

    total: number

    paid_amount: number

    booking_reference: string
  }

  const lines = all<AllocationRow>(
    `SELECT a.amount AS allocated, a.installment_id, i.number, i.kind, i.due_date,
            i.total, i.paid_amount, b.reference AS booking_reference
      FROM payment_allocations a
      JOIN payment_installments i ON i.id = a.installment_id AND i.tenant_id = a.tenant_id
      JOIN bookings b ON b.id = i.booking_id AND b.tenant_id = i.tenant_id
      WHERE a.tenant_id = ? AND a.payment_id = ?
      ORDER BY i.number ASC`,
    guarded.tenantId,
    paymentId,
  )

  interface CustomerRow {
    full_name: string

    phone: string

    email: string | null

    address_line1: string | null

    address_line2: string | null

    city: string | null

    state_region: string | null

    postal_code: string | null

    country: string | null
  }

  const customer = get<CustomerRow>(
    `SELECT full_name, phone, email, address_line1, address_line2, city,
            state_region, postal_code, country
      FROM customers WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    payment.customer_id,
  )

  return {
    payment: toPayment(payment),

    tenant: readTenantBlock(guarded.tenantId),

    customer: customer
      ? {
          name: customer.full_name,
          phone: customer.phone,
          email: customer.email,
          addressLine1: customer.address_line1,
          addressLine2: customer.address_line2,
          city: customer.city,
          stateRegion: customer.state_region,
          postalCode: customer.postal_code,
          country: customer.country,
        }
      : null,

    lines: lines.map((line) => ({
      installmentId: line.installment_id,
      number: line.number,
      kind: line.kind as InstallmentKind,
      dueDate: line.due_date,
      installmentTotal: line.total,
      paidAmount: line.paid_amount,
      allocated: line.allocated,
      bookingReference: line.booking_reference,
      displayStatus: deriveDisplayStatus(
        {
          id: line.installment_id,
          tenant_id: guarded.tenantId,
          plan_id: "",
          booking_id: "",
          number: line.number,
          kind: line.kind,
          due_date: line.due_date,
          amount: 0,
          charges: 0,
          total: line.total,
          paid_amount: line.paid_amount,
          status: "",
        },
        today,
      ),
    })),

    currency: payment.currency,
  }
}

/** GET /api/customers/:id/ledger — the append-only account trail, running balance last. */
export async function listCustomerLedger(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "view")

  const customerId = ctx.params.id

  const customer = get<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    customerId,
  )

  if (!customer) throw notFound("That customer does not exist")

  const entries = readCustomerLedger(
    guarded.tenantId,
    customerId,
    bookingReferenceMap(guarded.tenantId, customerId),
  )

  return {
    entries,

    currency: tenantCurrency(guarded.tenantId),

    balance: entries.length > 0 ? entries[entries.length - 1].balanceAfter : 0,
  }
}

/**
 * POST /api/payment-installments/:id/payments — book a receipt against a single line.
 *
 * The legacy per-line endpoint, now folded through the same allocation core as a one-line
 * payment, so it too mints a receipt number and writes a ledger debit. The amount is a
 * positive whole number and cannot take the recorded total past the line's balance, so
 * `paid_amount` never exceeds `total`; the stored status stays a pure function of that.
 */
export async function recordInstallmentPayment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "payments", "edit")

  const installmentId = ctx.params.id

  if (!installmentId) throw notFound("That installment does not exist")

  const installment = get<InstallmentRow>(
    `SELECT * FROM payment_installments WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    installmentId,
  )

  if (!installment) throw notFound("That installment does not exist")

  const booking = get<{ customer_id: string }>(
    `SELECT customer_id FROM bookings WHERE tenant_id = ? AND id = ?`,
    guarded.tenantId,
    installment.booking_id,
  )

  if (!booking) throw notFound("That installment does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const amount = readBoundedInt(body.amount, 1, PAYMENT_AMOUNT_MAX)

  if (amount === null) {
    throw badRequest("Check the highlighted fields", {
      amount: `Enter a whole number from 1 to ${PAYMENT_AMOUNT_MAX}.`,
    })
  }

  if (installment.paid_amount + amount > installment.total) {
    throw badRequest("Check the highlighted fields", {
      amount: "This payment exceeds the remaining balance on the installment.",
    })
  }

  const receivedAt =
    typeof body.receivedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.receivedAt.trim())
      ? body.receivedAt.trim()
      : now()

  const result = transaction(() =>
    recordPaymentWithinTransaction(guarded, {
      customerId: booking.customer_id,
      method: isPaymentMethod(body.method)
        ? body.method as PaymentMethod
        : "cash",
      amount,
      allocations: [{ installmentId, amount }],
      receivedAt,
      note: null,
      bookingId: installment.booking_id,
    }),
  )

  const updated = result.installments[0] ?? installment

  writeAudit(
    guarded,
    "payment.installment.recorded",
    "payment_installment",
    installmentId,
    { amount, paidAmount: updated.paid_amount, total: updated.total },
    ctx.ip,
  )

  // The same off-ledger thank-you the general payment path sends, keyed to this
  // receipt's own payment id so a replay can never double-announce it.
  void sendPaymentReceivedConfirmation(guarded.tenantId, result.payment.id)

  return {
    installment: toInstallment(updated, tenantToday(guarded.tenantId)),

    currency: tenantCurrency(guarded.tenantId),

    payment: toPayment(result.payment),

    ledgerEntry: result.ledgerEntry,
  }
}
