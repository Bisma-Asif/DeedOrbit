/**
 * The booking module: a unit formally committed to a customer.
 *
 * A booking is the point where a sales conversation becomes a record. It ties a
 * real customer (the lead-convert step happens elsewhere, so a booking always names
 * somebody who exists as a customer) to a real unit, notes the amount and date
 * taken, the terms agreed, and — optionally — the channel that brought it: an
 * internal sales agent, an external dealer, or neither.
 *
 * The one thing a booking does beyond its own row is drive the unit's status. That
 * is the split the schema reserved for it: creation moves the unit to the built-in
 * `booked` status and cancellation returns it to `available`, each recorded on the
 * status trail as `source: 'system'` with no actor, through the inventory route's
 * `applySystemUnitStatus`. A booking therefore needs only its own `bookings.*`
 * grants — never `inventory.change_status` — because moving the unit is a
 * consequence of the booking, not a separate manual edit of the stock.
 *
 * Lifecycle is deliberately two states: `confirmed` and `cancelled`. There is no
 * approval queue and no field editing here by design; a booking that needs changing
 * is cancelled and re-made, which keeps the trail honest the same way the
 * append-only quotation history does.
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

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import {
  BOOKABLE_UNIT_STATUS_KEYS,
  BOOKED_UNIT_STATUS_KEY,
  AVAILABLE_UNIT_STATUS_KEY,
  BOOKING_AMOUNT_MAX,
  BOOKING_NOTES_MAX,
  BOOKING_TERMS_MAX,
} from "../../shared/bookings.ts"

import {
  CANCELLATION_AMOUNT_MAX,
  CANCELLATION_PERCENT_BPS_MAX,
  CANCELLATION_REASON_MAX,
  isCancellationMode,
  isUnitOutcome,
  type CancellationMode,
  type UnitOutcome,
} from "../../shared/cancellation.ts"

import { appendLedgerEntry } from "../ledger.ts"

import { notifyRecipients } from "../notify.ts"

import { emitEvent } from "../webhooks.ts"

const BLOCKED_UNIT_STATUS_KEY = "hold"

import { describeStatus, readStatusMap } from "./unit-statuses.ts"
import {
  applySystemUnitStatus,
  readUnit,
  requireScopedProject,
} from "./project-inventory.ts"

import { readUnitFacts } from "../unit-facts.ts"

import type {
  BookingApprovalPayload,
  CancellationApprovalPayload,
  DocumentOverrideApprovalPayload,
} from "../../shared/approvals.ts"

import {
  approvedDocOverrideExists,
  documentsGateState,
} from "../document-verification-core.ts"

import {
  approvalGate,
  insertApproval,
  pendingApprovalFor,
} from "./approvals.ts"

const now = () => new Date().toISOString()

const today = () => new Date().toISOString().slice(0, 10)

/** Newest-first cap for the list, mirroring the quotation history limit. */

const BOOKING_LIST_LIMIT = 200

interface BookingRow {
  id: string

  tenant_id: string

  project_id: string

  unit_id: string

  customer_id: string

  quote_id: string | null

  agent_user_id: string | null

  agent_name: string | null

  dealer_id: string | null

  dealer_name: string | null

  reference: string

  unit_code: string

  customer_name: string

  booking_amount: number

  booking_date: string

  status: string

  terms: string

  notes: string | null

  created_by_name: string

  cancelled_by_name: string | null

  cancelled_at: string | null

  created_at: string

  updated_at: string

  project_name: string
}

const BOOKING_SELECT = `
  SELECT b.*, p.name AS project_name
    FROM bookings b
    JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
`

function toBooking(row: BookingRow) {
  return {
    id: row.id,

    projectId: row.project_id,

    projectName: row.project_name,

    unitId: row.unit_id,

    unitCode: row.unit_code,

    customerId: row.customer_id,

    customerName: row.customer_name,

    quoteId: row.quote_id,

    agentUserId: row.agent_user_id,

    agentName: row.agent_name,

    dealerId: row.dealer_id,

    dealerName: row.dealer_name,

    reference: row.reference,

    bookingAmount: row.booking_amount,

    bookingDate: row.booking_date,

    status: row.status,

    terms: row.terms,

    notes: row.notes,

    createdByName: row.created_by_name,

    cancelledByName: row.cancelled_by_name,

    cancelledAt: row.cancelled_at,

    createdAt: row.created_at,

    updatedAt: row.updated_at,
  }
}

/** The quotation columns read for a booking's provenance line. Named so oxfmt
 *  cannot strip the member separator from an inline generic type literal. */
interface QuoteRef {
  quote_number: string

  total: number
}

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}

/**
 * A fully-resolved create body, ready to insert.
 *
 * The names (customer, agent, dealer, unit code) are carried alongside the ids so the
 * insert is a single statement, and so the deferred approval path can rebuild the same
 * body from its stored payload after re-resolving them against the live database.
 */
export interface BookingCreateInput {
  projectId: string

  unitId: string

  customerId: string

  quoteId: string | null

  agentUserId: string | null

  agentName: string | null

  dealerId: string | null

  dealerName: string | null

  unitCode: string

  customerName: string

  bookingAmount: number

  bookingDate: string

  terms: string

  notes: string | null
}

/**
 * Inserts a booking and drives its unit to `booked`, returning the stored row.
 *
 * Runs inside the caller's transaction and is the single source of truth for what
 * "make this booking" does — the immediate `createBooking` path calls it, and the
 * approvals engine replays a deferred request through exactly this function, so an
 * approved booking is identical to one that was never held.
 */
export function createBookingRecord(
  tenantId: string,
  actorUserId: string,
  actorName: string,
  input: BookingCreateInput,
): BookingRow {
  const id = `book_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  // Per-unit numbering, read inside the transaction so two creates on the same unit in
  // one moment cannot both claim the next number.
  const count =
    get<{ total: number }>(
      `SELECT count(*) AS total FROM bookings
        WHERE tenant_id = ? AND project_id = ? AND unit_id = ?`,
      tenantId,
      input.projectId,
      input.unitId,
    )?.total ?? 0

  const reference = `BK-${input.unitCode}-${String(count + 1).padStart(3, "0")}`

  run(
    `INSERT INTO bookings (
      id, tenant_id, project_id, unit_id, customer_id, quote_id,
      agent_user_id, agent_name, dealer_id, dealer_name, reference, unit_code,
      customer_name, booking_amount, booking_date, status, terms, notes,
      created_by_user_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?)`,
    id,
    tenantId,
    input.projectId,
    input.unitId,
    input.customerId,
    input.quoteId,
    input.agentUserId,
    input.agentName,
    input.dealerId,
    input.dealerName,
    reference,
    input.unitCode,
    input.customerName,
    input.bookingAmount,
    input.bookingDate,
    input.terms,
    input.notes,
    actorUserId,
    actorName,
    stamp,
    stamp,
  )

  applySystemUnitStatus(
    tenantId,
    input.projectId,
    input.unitId,
    BOOKED_UNIT_STATUS_KEY,
    `Booked via ${reference}`,
  )

  const row = get<BookingRow>(
    `${BOOKING_SELECT} WHERE b.tenant_id = ? AND b.id = ?`,
    tenantId,
    id,
  )

  if (!row) throw notFound("That booking does not exist")

  return row
}

/** The booking row for a tenant by id, or a not-found that reads as absent. */
export function readBookingRow(tenantId: string, id: string): BookingRow {
  const row = get<BookingRow>(
    `SELECT b.* FROM bookings b WHERE b.tenant_id = ? AND b.id = ?`,
    tenantId,
    id,
  )

  if (!row) throw notFound("That booking does not exist")

  return row
}

/**
 * The money a cancellation moves, derived from the tenant's rules and what was paid.
 *
 * `hasRules` records whether the workspace has configured a `cancellation_rules` row at
 * all: with none, cancelling is the plain status flip it always was and no ledger money
 * is written, so an untouched tenant's behaviour never changes. With a rule, the charge is
 * a flat figure or a basis-point slice of the amount paid to date (capped, and never more
 * than was paid), and the refund is the remainder. `unitOutcome` decides whether the freed
 * unit returns to the market or is held.
 */
interface CancellationOutcome {
  hasRules: boolean

  enabled: boolean

  chargeAmount: number

  refundAmount: number

  unitOutcome: UnitOutcome
}

interface CancellationRuleRow {
  enabled: number

  mode: string

  amount: number

  percent_bps: number

  cap_amount: number

  unit_outcome: string
}

function paidOnBooking(tenantId: string, bookingId: string): number {
  return (
    get<{ paid: number }>(
      `SELECT COALESCE(SUM(paid_amount), 0) AS paid
        FROM payment_installments WHERE tenant_id = ? AND booking_id = ?`,
      tenantId,
      bookingId,
    )?.paid ?? 0
  )
}

export function computeCancellationOutcome(
  tenantId: string,
  bookingId: string,
): CancellationOutcome {
  const rule = get<CancellationRuleRow>(
    `SELECT enabled, mode, amount, percent_bps, cap_amount, unit_outcome
      FROM cancellation_rules WHERE tenant_id = ?`,
    tenantId,
  )

  if (!rule) {
    return {
      hasRules: false,
      enabled: false,
      chargeAmount: 0,
      refundAmount: 0,
      unitOutcome: "available",
    }
  }

  const paid = paidOnBooking(tenantId, bookingId)

  let chargeAmount = 0

  if (rule.enabled === 1) {
    if (rule.mode === "percent") {
      chargeAmount = Math.round((paid * rule.percent_bps) / 10000)
    } else {
      chargeAmount = rule.amount
    }

    if (rule.cap_amount > 0)
      chargeAmount = Math.min(chargeAmount, rule.cap_amount)

    chargeAmount = Math.max(0, Math.min(chargeAmount, paid))
  }

  return {
    hasRules: true,
    enabled: rule.enabled === 1,
    chargeAmount,
    refundAmount: Math.max(0, paid - chargeAmount),
    unitOutcome: isUnitOutcome(rule.unit_outcome)
      ? rule.unit_outcome
      : "available",
  }
}

/**
 * Marks a booking cancelled and returns its unit to the market if the booking left it
 * there. Runs inside the caller's transaction; the single source of truth for a cancel,
 * shared by the immediate `cancelBooking` path and the approvals engine's replay.
 *
 * When `outcome` carries configured rules with money to move, a charge and a refund ledger
 * row are written alongside the status change; without them (an untouched workspace) this
 * is the plain cancellation it has always been.
 */
export function applyCancellation(
  tenantId: string,
  actorName: string,
  booking: BookingRow,
  outcome?: CancellationOutcome,
  recordedByUserId?: string,
): BookingRow {
  const stamp = now()

  run(
    `UPDATE bookings
      SET status = 'cancelled', cancelled_by_name = ?, cancelled_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,
    actorName,
    stamp,
    stamp,
    tenantId,
    booking.id,
  )

  const applyMoney =
    outcome !== undefined &&
    outcome.hasRules &&
    (outcome.chargeAmount > 0 || outcome.refundAmount > 0)

  if (applyMoney && recordedByUserId) {
    const currency = tenantCurrency(tenantId)

    if (outcome.chargeAmount > 0) {
      appendLedgerEntry({
        tenantId,
        customerId: booking.customer_id,
        kind: "cancellation_charge",
        amount: outcome.chargeAmount,
        currency,
        occurredAt: stamp,
        recordedByUserId,
        recordedByName: actorName,
        bookingId: booking.id,
        reference: booking.reference,
        sourceType: "booking",
        sourceId: booking.id,
        note: "Cancellation charge",
      })
    }

    if (outcome.refundAmount > 0) {
      appendLedgerEntry({
        tenantId,
        customerId: booking.customer_id,
        kind: "cancellation_refund",
        amount: -outcome.refundAmount,
        currency,
        occurredAt: stamp,
        recordedByUserId,
        recordedByName: actorName,
        bookingId: booking.id,
        reference: booking.reference,
        sourceType: "booking",
        sourceId: booking.id,
        note: "Cancellation refund",
      })
    }
  }

  // Return the unit only if it is still where this booking left it. If somebody has
  // since moved it on by hand, the cancellation stands but the unit is left alone.
  const unit = get<{ status: string }>(
    `SELECT status FROM inventory_units
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,
    tenantId,
    booking.project_id,
    booking.unit_id,
  )

  if (unit?.status === BOOKED_UNIT_STATUS_KEY) {
    const target =
      outcome?.hasRules && outcome.unitOutcome === "blocked"
        ? BLOCKED_UNIT_STATUS_KEY
        : AVAILABLE_UNIT_STATUS_KEY

    applySystemUnitStatus(
      tenantId,
      booking.project_id,
      booking.unit_id,
      target,
      `Booking ${booking.reference} cancelled`,
    )
  }

  const updated = get<BookingRow>(
    `${BOOKING_SELECT} WHERE b.tenant_id = ? AND b.id = ?`,
    tenantId,
    booking.id,
  )

  if (!updated) throw notFound("That booking does not exist")

  return updated
}

/**
 * Rebuilds a create body from a stored booking-approval payload, re-resolving every
 * name against the live database and re-checking the unit can still be booked.
 *
 * The payload stores ids plus snapshot labels for display; on approval those ids are
 * looked up again so the booking carries whoever the customer, agent, and dealer are
 * now called, and a unit sold or held while the request waited is refused rather than
 * double-committed.
 */
export function resolveBookingApprovalInput(
  tenantId: string,
  payload: BookingApprovalPayload,
): BookingCreateInput {
  const unit = readUnit(tenantId, payload.projectId, payload.unitId)

  if (!BOOKABLE_UNIT_STATUS_KEYS.includes(unit.status)) {
    const label = describeStatus(
      unit.status,
      readStatusMap(tenantId),
    ).statusLabel

    throw conflict(`This unit is ${label} and can no longer be booked.`)
  }

  const customer = get<{ full_name: string }>(
    "SELECT full_name FROM customers WHERE tenant_id = ? AND id = ?",
    tenantId,
    payload.customerId,
  )

  if (!customer)
    throw conflict("The customer on this request no longer exists.")

  let agentName: string | null = null

  if (payload.agentUserId) {
    agentName =
      get<{ full_name: string }>(
        "SELECT full_name FROM users WHERE tenant_id = ? AND id = ?",
        tenantId,
        payload.agentUserId,
      )?.full_name ?? null
  }

  let dealerName: string | null = null

  if (payload.dealerId) {
    dealerName =
      get<{ company_name: string }>(
        "SELECT company_name FROM dealers WHERE tenant_id = ? AND id = ?",
        tenantId,
        payload.dealerId,
      )?.company_name ?? null
  }

  return {
    projectId: payload.projectId,
    unitId: payload.unitId,
    customerId: payload.customerId,
    quoteId: payload.quoteId,
    agentUserId: payload.agentUserId,
    agentName,
    dealerId: payload.dealerId,
    dealerName,
    unitCode: unit.unit_code,
    customerName: customer.full_name,
    bookingAmount: payload.bookingAmount,
    bookingDate: payload.bookingDate,
    terms: payload.terms,
    notes: payload.notes,
  }
}

/** GET /api/bookings?projectId= */

export async function listBookings(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "bookings", "view")

  const projectId = ctx.query.get("projectId")

  const where = ["b.tenant_id = ?"]

  const params: (string | number)[] = [guarded.tenantId]

  if (projectId) {
    where.push("b.project_id = ?")

    params.push(projectId)
  }

  const rows = all<BookingRow>(
    `${BOOKING_SELECT} WHERE ${where.join(" AND ")}
      ORDER BY b.created_at DESC, b.rowid DESC
      LIMIT ?`,

    ...params,

    BOOKING_LIST_LIMIT,
  )

  return {
    bookings: rows.map(toBooking),

    currency: tenantCurrency(guarded.tenantId),

    canCreate: guarded.can("bookings", "create"),

    canApprove: guarded.can("bookings", "approve"),

    truncated: rows.length === BOOKING_LIST_LIMIT,
  }
}

/** GET /api/bookings/:id */

export async function getBooking(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "bookings", "view")

  const id = ctx.params.id

  if (!id) throw notFound("That booking does not exist")

  const row = get<BookingRow>(
    `${BOOKING_SELECT} WHERE b.tenant_id = ? AND b.id = ?`,
    guarded.tenantId,
    id,
  )

  if (!row) throw notFound("That booking does not exist")

  const quote = row.quote_id
    ? get<QuoteRef>(
        `SELECT quote_number, total FROM unit_quotations
          WHERE tenant_id = ? AND id = ?`,

        guarded.tenantId,

        row.quote_id,
      )
    : null

  // The classification the booking prints with. Read from the live unit rather than
  // snapshotted onto the booking row: the property type and its size are the unit's own
  // facts, a booking page must stay readable for a role that has no `inventory.view`,
  // and a unit whose row has gone still gets its booking, with dashes where the
  // property details would be.
  const facts = readUnitFacts(
    guarded.tenantId,

    row.project_id,

    row.unit_id,
  )

  return {
    booking: {
      ...toBooking(row),

      quoteNumber: quote?.quote_number ?? null,

      quoteTotal: quote?.total ?? null,

      unitFacts: facts,
    },

    currency: tenantCurrency(guarded.tenantId),

    canApprove: guarded.can("bookings", "approve"),
  }
}

/** POST /api/bookings */

export async function createBooking(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "bookings", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const projectId = typeof body.projectId === "string" ? body.projectId : ""

  const unitId = typeof body.unitId === "string" ? body.unitId : ""

  const customerId = typeof body.customerId === "string" ? body.customerId : ""

  const agentUserId =
    typeof body.agentUserId === "string" && body.agentUserId !== ""
      ? body.agentUserId
      : null

  const dealerId =
    typeof body.dealerId === "string" && body.dealerId !== ""
      ? body.dealerId
      : null

  const quoteId =
    typeof body.quoteId === "string" && body.quoteId !== ""
      ? body.quoteId
      : null

  // The project and its currency first: every other lookup is tenant-scoped, and a

  // project that is not this tenant's reads as absent rather than forbidden.

  let currency = "AED"

  try {
    currency = requireScopedProject(guarded.tenantId, projectId)
  } catch {
    errors.projectId = "Choose a project in this workspace."
  }

  // The unit belongs to the chosen project; its status decides whether a booking is

  // even possible, so this is read before the rest of the field checks.

  let unitCode = ""

  if (projectId && !errors.projectId) {
    try {
      const unit = readUnit(guarded.tenantId, projectId, unitId)

      unitCode = unit.unit_code

      if (!BOOKABLE_UNIT_STATUS_KEYS.includes(unit.status)) {
        const label = describeStatus(
          unit.status,
          readStatusMap(guarded.tenantId),
        ).statusLabel

        throw conflict(`This unit is ${label} and cannot be booked.`)
      }
    } catch (error) {
      if (error instanceof Error && "status" in error) throw error

      errors.unitId = "Choose a unit in this project."
    }
  } else if (!unitId) {
    errors.unitId = "Choose the unit being booked."
  }

  let customerName: string | null = null

  if (!customerId) {
    errors.customerId = "A booking must name a customer."
  } else {
    const customer = get<{ full_name: string }>(
      "SELECT full_name FROM customers WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      customerId,
    )

    if (!customer) errors.customerId = "Choose a customer in this workspace."
    else customerName = customer.full_name
  }

  const rawAmount = body.bookingAmount

  let bookingAmount = 0

  if (
    typeof rawAmount !== "number" ||
    !Number.isSafeInteger(rawAmount) ||
    rawAmount < 0 ||
    rawAmount > BOOKING_AMOUNT_MAX
  ) {
    errors.bookingAmount = `Enter a whole number from 0 to ${BOOKING_AMOUNT_MAX}.`
  } else {
    bookingAmount = rawAmount
  }

  const bookingDate =
    typeof body.bookingDate === "string" ? body.bookingDate.trim() : ""

  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    errors.bookingDate = "Enter the booking date as YYYY-MM-DD."
  }

  const terms = typeof body.terms === "string" ? body.terms.trim() : ""

  if (terms === "") {
    errors.terms = "Record the terms agreed with the customer."
  } else if (terms.length > BOOKING_TERMS_MAX) {
    errors.terms = `Use ${BOOKING_TERMS_MAX} characters or fewer.`
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim()
      : null

  if (notes !== null && notes.length > BOOKING_NOTES_MAX) {
    errors.notes = `Use ${BOOKING_NOTES_MAX} characters or fewer.`
  }

  // An agent is a member of this tenant; a dealer is a partner in it. Both are

  // optional, and both are snapshotted so the booking still reads correctly after

  // the person or partner is renamed or leaves.

  let agentName: string | null = null

  if (agentUserId) {
    const agent = get<{ full_name: string }>(
      "SELECT full_name FROM users WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      agentUserId,
    )

    if (!agent) errors.agentUserId = "Choose an agent in this workspace."
    else agentName = agent.full_name
  }

  let dealerName: string | null = null

  if (dealerId) {
    const dealer = get<{ company_name: string }>(
      "SELECT company_name FROM dealers WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      dealerId,
    )

    if (!dealer) errors.dealerId = "Choose a dealer in this workspace."
    else dealerName = dealer.company_name
  }

  // A quote id is provenance only, and must belong to the same unit; a mismatch is a

  // field error rather than a silent drop, because it would mislabel the booking.

  if (quoteId && unitId) {
    const quote = get<{ id: string }>(
      `SELECT id FROM unit_quotations
        WHERE tenant_id = ? AND id = ? AND unit_id = ?`,

      guarded.tenantId,

      quoteId,

      unitId,
    )

    if (!quote) errors.quoteId = "That quotation is not for this unit."
  }

  if (Object.keys(errors).length > 0)
    throw badRequest("Check the highlighted fields", errors)

  const input: BookingCreateInput = {
    projectId,
    unitId,
    customerId,
    quoteId,
    agentUserId,
    agentName,
    dealerId,
    dealerName,
    unitCode,
    customerName: customerName ?? "",
    bookingAmount,
    bookingDate,
    terms,
    notes,
  }

  // --- Document verification block rule (booking gate) ----------------------
  // When the tenant turned the booking block on, a confirmed booking is held back
  // until every required document is verified. A second, entitled person can sign
  // off an override; that approved override is the release token the officer's retry
  // reads. With the setting off (the default) this block does nothing, so existing
  // tenants and tests are untouched.
  const docGate = documentsGateState(
    guarded.tenantId,
    customerId,
    "booking",
    today(),
  )

  if (
    docGate.applies &&
    !docGate.ok &&
    !approvedDocOverrideExists(guarded.tenantId, customerId)
  ) {
    if (body.overrideDocBlock === true) {
      if (!docGate.allowOverride) {
        throw conflict(
          "This workspace does not allow document overrides for bookings.",
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
          customerId,
        )?.customer_type ?? "individual"

      const override: DocumentOverrideApprovalPayload = {
        gate: "booking",
        projectId,
        unitId,
        customerId,
        customerType,
        agentUserId,
        bookingId: null,
        planId: null,
        missingKeys: docGate.missingKeys,
        reason,
      }

      const approval = insertApproval({
        tenantId: guarded.tenantId,
        actionKey: "document_booking_override",
        summary: `Document override for ${customerName ?? "—"} — booking ${unitCode} (missing: ${docGate.missingLabels.join(", ")})`,
        payload: override,
        entityType: "customer",
        resultEntityId: customerId,
        requestedByUserId: guarded.userId,
        requestedByName: guarded.session.user.fullName,
      })

      writeAudit(
        guarded,
        "project.booking.override_requested",
        "approval",
        approval.id,
        { customerId, missingKeys: docGate.missingKeys, reason },
        ctx.ip,
      )

      return {
        approval,
        pending: true,
        blockedByDocuments: docGate.missingLabels,
        currency,
      }
    }

    throw new HttpError(
      409,
      "documents_required",
      `This customer still needs documents before booking: ${docGate.missingLabels.join(", ")}.`,
      {
        missingDocuments: docGate.missingLabels.join(", "),
        missingKeys: docGate.missingKeys.join(", "),
        overrideAllowed: String(docGate.allowOverride),
      },
    )
  }

  // Above the tenant's booking threshold the request is held rather than applied: the
  // validated body is stored as an approval payload and nothing changes — no booking
  // row, no unit move — until a different, entitled user signs it off.
  if (approvalGate(guarded.tenantId, "booking", bookingAmount)) {
    const payload: BookingApprovalPayload = {
      projectId,
      unitId,
      customerId,
      agentUserId,
      dealerId,
      quoteId,
      bookingAmount,
      bookingDate,
      terms,
      notes,
      unitCode,
      customerName: customerName ?? "",
    }

    const approval = insertApproval({
      tenantId: guarded.tenantId,
      actionKey: "booking",
      // The summary is what an approver reads in the queue, so the money leads
      // with the currency and is grouped — a bare digit run is unreadable.
      summary: `Booking ${unitCode} for ${customerName ?? "—"} — ${currency} ${new Intl.NumberFormat("en-US").format(bookingAmount)}`,
      payload,
      entityType: "booking",
      resultEntityId: null,
      requestedByUserId: guarded.userId,
      requestedByName: guarded.session.user.fullName,
    })

    writeAudit(
      guarded,
      "project.booking.deferred",
      "approval",
      approval.id,
      { projectId, unitId, customerId, bookingAmount, currency },
      ctx.ip,
    )

    return { approval, pending: true, currency }
  }

  const row = transaction(() =>
    createBookingRecord(
      guarded.tenantId,
      guarded.userId,
      guarded.session.user.fullName,
      input,
    ),
  )

  writeAudit(
    guarded,
    "project.booking.created",
    "booking",
    row.id,
    {
      projectId,
      unitId,
      customerId,
      reference: row.reference,
      bookingAmount,
      currency,
    },
    ctx.ip,
  )

  // The agent who owns the sale hears about it; whoever just booked it does not
  // need a notification for their own action. When the booking carries no separate
  // agent, the creator is the actor and this writes nothing — better an honest
  // silence than a self-notification.
  notifyRecipients(guarded.tenantId, [row.agent_user_id], {
    type: "booking_confirmed",
    title: `Booking confirmed: ${row.reference}`,
    body: `${row.unit_code} · ${row.customer_name}`,
    linkPath: `/bookings/${row.id}`,
    actorUserId: guarded.userId,
    actorName: guarded.session.user.fullName,
  })

  // Fire after the transaction has committed; the log owns the delivery outcome.
  void emitEvent(guarded.tenantId, "booking_created", {
    event: "booking_created",
    bookingId: row.id,
    reference: row.reference,
    unitCode: row.unit_code,
    customerName: row.customer_name,
    bookingAmount: row.booking_amount,
    status: row.status,
    createdAt: row.created_at,
  })

  return { booking: toBooking(row), currency }
}

/** POST /api/bookings/:id/cancel */

/**
 * Cancels a booking with the tenant's rules applied. The single source of truth for a
 * completed cancellation: the immediate path and the approvals engine's replay both call
 * it, so the charge, refund, and unit outcome are re-derived from the live rows every time
 * rather than trusted from a stored snapshot. Runs inside the caller's transaction.
 */
export function applyCancellationWithCharges(
  tenantId: string,
  actorName: string,
  actorUserId: string,
  booking: BookingRow,
): BookingRow {
  const outcome = computeCancellationOutcome(tenantId, booking.id)

  return applyCancellation(tenantId, actorName, booking, outcome, actorUserId)
}

export async function cancelBooking(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "bookings", "approve")

  const id = ctx.params.id

  if (!id) throw notFound("That booking does not exist")

  const row = get<BookingRow>(
    `SELECT b.* FROM bookings b WHERE b.tenant_id = ? AND b.id = ?`,
    guarded.tenantId,
    id,
  )

  if (!row) throw notFound("That booking does not exist")

  if (row.status === "cancelled")
    throw conflict("This booking is already cancelled.")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const reason =
    typeof body.reason === "string"
      ? body.reason.trim().slice(0, CANCELLATION_REASON_MAX)
      : ""

  const outcome = computeCancellationOutcome(guarded.tenantId, id)

  // A cancellation the tenant has chosen to gate is held as a request: the booking
  // stays confirmed and the unit stays booked until an approver signs the replay.
  if (approvalGate(guarded.tenantId, "cancellation")) {
    const held = pendingApprovalFor(guarded.tenantId, "cancellation", id)

    if (held) return { approval: held, pending: true }

    const payload: CancellationApprovalPayload = {
      bookingId: id,
      reference: row.reference,
      customerName: row.customer_name,
      reason,
      chargeAmount: outcome.chargeAmount,
      refundAmount: outcome.refundAmount,
    }

    const approval = insertApproval({
      tenantId: guarded.tenantId,
      actionKey: "cancellation",
      summary: `Cancel ${row.reference}`,
      payload,
      entityType: "booking",
      resultEntityId: id,
      requestedByUserId: guarded.userId,
      requestedByName: guarded.session.user.fullName,
    })

    writeAudit(
      guarded,
      "project.booking.cancel_deferred",
      "approval",
      approval.id,
      {
        projectId: row.project_id,
        unitId: row.unit_id,
        reference: row.reference,
      },
      ctx.ip,
    )

    return { approval, pending: true }
  }

  const updated = transaction(() =>
    applyCancellationWithCharges(
      guarded.tenantId,
      guarded.session.user.fullName,
      guarded.userId,
      row,
    ),
  )

  writeAudit(
    guarded,
    "project.booking.cancelled",
    "booking",
    id,
    {
      projectId: row.project_id,
      unitId: row.unit_id,
      reference: row.reference,
    },
    ctx.ip,
  )

  return { booking: toBooking(updated) }
}

/**
 * GET /api/bookings/:id/cancellation-preview — the charge and refund the rules would apply.
 *
 * The cancel dialog calls this before submitting so the canceller sees, and the approver
 * later confirms, exactly what cancelling will cost and return.
 */
export async function cancellationPreview(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "bookings", "view")

  const id = ctx.params.id

  const row = readBookingRow(guarded.tenantId, id)

  const outcome = computeCancellationOutcome(guarded.tenantId, id)

  return {
    bookingId: row.id,
    reference: row.reference,
    paidAmount: paidOnBooking(guarded.tenantId, id),
    hasRules: outcome.hasRules,
    enabled: outcome.enabled,
    chargeAmount: outcome.chargeAmount,
    refundAmount: outcome.refundAmount,
    unitOutcome: outcome.unitOutcome,
    requiresApproval: approvalGate(guarded.tenantId, "cancellation"),
    currency: tenantCurrency(guarded.tenantId),
  }
}

// --- Cancellation rules (settings) ----------------------------------------

interface CancellationRuleView {
  enabled: boolean

  mode: CancellationMode

  amount: number

  percentBps: number

  capAmount: number

  unitOutcome: UnitOutcome
}

function toCancellationRuleView(
  row: CancellationRuleRow | undefined,
): CancellationRuleView {
  const modeValue = row?.mode
  const outcomeValue = row?.unit_outcome

  return {
    enabled: row?.enabled === 1,
    mode: isCancellationMode(modeValue) ? modeValue : "percent",
    amount: row?.amount ?? 0,
    percentBps: row?.percent_bps ?? 0,
    capAmount: row?.cap_amount ?? 0,
    unitOutcome: isUnitOutcome(outcomeValue) ? outcomeValue : "available",
  }
}

/** GET /api/settings/cancellation-rules */
export async function getCancellationRules(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "view")

  const row = get<CancellationRuleRow>(
    `SELECT enabled, mode, amount, percent_bps, cap_amount, unit_outcome
      FROM cancellation_rules WHERE tenant_id = ?`,
    guarded.tenantId,
  )

  return { rules: toCancellationRuleView(row), configured: row !== undefined }
}

function readBoundedCancellationInt(
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

/** PATCH /api/settings/cancellation-rules */
export async function updateCancellationRules(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "settings", "edit")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const enabled = body.enabled === true

  const mode: CancellationMode = isCancellationMode(body.mode)
    ? body.mode
    : "percent"

  const amount = readBoundedCancellationInt(
    body.amount,
    0,
    CANCELLATION_AMOUNT_MAX,
  )

  if (amount === null)
    errors.amount = `Enter a whole number from 0 to ${CANCELLATION_AMOUNT_MAX}.`

  const percentBps = readBoundedCancellationInt(
    body.percentBps,
    0,
    CANCELLATION_PERCENT_BPS_MAX,
  )

  if (percentBps === null)
    errors.percentBps = `Enter whole basis points from 0 to ${CANCELLATION_PERCENT_BPS_MAX}.`

  const capAmount = readBoundedCancellationInt(
    body.capAmount,
    0,
    CANCELLATION_AMOUNT_MAX,
  )

  if (capAmount === null)
    errors.capAmount = `Enter a whole number from 0 to ${CANCELLATION_AMOUNT_MAX}.`

  const unitOutcome: UnitOutcome = isUnitOutcome(body.unitOutcome)
    ? body.unitOutcome
    : "available"

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const stamp = now()

  run(
    `INSERT INTO cancellation_rules (
        tenant_id, enabled, mode, amount, percent_bps, cap_amount, unit_outcome, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id) DO UPDATE SET
        enabled = excluded.enabled,
        mode = excluded.mode,
        amount = excluded.amount,
        percent_bps = excluded.percent_bps,
        cap_amount = excluded.cap_amount,
        unit_outcome = excluded.unit_outcome,
        updated_at = excluded.updated_at`,
    guarded.tenantId,
    enabled ? 1 : 0,
    mode,
    amount,
    percentBps,
    capAmount,
    unitOutcome,
    stamp,
  )

  writeAudit(
    guarded,
    "tenant.cancellation_rules_updated",
    "tenant",
    guarded.tenantId,
    { enabled, mode, amount, percentBps, capAmount, unitOutcome },
    ctx.ip,
  )

  const row = get<CancellationRuleRow>(
    `SELECT enabled, mode, amount, percent_bps, cap_amount, unit_outcome
      FROM cancellation_rules WHERE tenant_id = ?`,
    guarded.tenantId,
  )

  return { rules: toCancellationRuleView(row), configured: true }
}
