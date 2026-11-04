import { all, get, isUniqueViolation, run } from "../db.ts"

import {
  badRequest,
  conflict,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import {
  requireAuth,
  requirePermission,
  requireAnyPermission,
  writeAudit,
} from "../middleware.ts"

import { newId } from "../crypto.ts"

import { isUnitType, type UnitType } from "../../shared/inventory.ts"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const PHONE = /^[+\d(][\d\s().-]*\d$/

interface DealerRow {
  id: string

  tenant_id: string

  portal_user_id: string | null

  company_name: string

  contact_name: string

  email: string | null

  phone: string

  business_registration: string | null

  tax_id: string | null

  address: string | null

  notes: string | null

  status: "active" | "suspended"

  created_at: string

  updated_at: string
}

interface DealerSummaryRow extends DealerRow {
  lead_count: number

  booking_count: number

  commission_total: number

  commission_paid: number
}

interface CommissionRuleRow {
  id: string

  dealer_id: string

  scope: "project" | "unit_type"

  project_id: string | null

  project_name: string | null

  unit_type: UnitType | null

  commission_type: "percentage" | "fixed"

  commission_value: number
}

interface DealerBookingRow {
  id: string

  booking_reference: string

  customer_name: string

  project_id: string

  project_name: string

  unit_type: UnitType

  booking_amount: number

  booking_date: string

  status: "pending" | "confirmed" | "cancelled"

  commission_type: "percentage" | "fixed" | null

  commission_value: number | null

  commission_amount: number | null

  paid_amount: number
}

type DealerRuleInput = Record<string, unknown> & {
  scope: "project" | "unit_type"

  projectId: string | null

  unitType: UnitType | null

  commissionType: "percentage" | "fixed"

  commissionValue: number
}

interface DealerValues {
  portalUserId: string | null

  companyName: string

  contactName: string

  email: string | null

  phone: string

  businessRegistration: string | null

  taxId: string | null

  address: string | null

  notes: string | null

  status: "active" | "suspended"
}

interface DealerListOptions {
  id: string

  name: string

  type: string
}

interface DealerLeadRow {
  id: string

  full_name: string

  phone: string

  email: string | null

  project_interest: string | null

  status: string

  status_label: string

  assigned_agent_name: string | null

  created_at: string
}

interface DealerProjectOption {
  id: string

  name: string

  currency: string
}

interface DealerPortalUserRow {
  id: string
  name: string
}

interface LeadAssignmentRow {
  id: string
  assigned_dealer_id: string | null
}

interface ProjectForBooking {
  id: string
  name: string
}

interface DealerBookingStatusRow {
  commission_amount: number | null
  status: string
}

interface DealerBookingCreateResult {
  reference: string
  customerName: string
  projectId: string
  unitType: UnitType
  bookingAmount: number
  bookingDate: string
  leadId: string | null
}

function optionalText(
  value: unknown,
  max: number,
  key: string,
  errors: Record<string, string>,
): string | null {
  if (value === undefined || value === null || value === "") return null

  if (typeof value !== "string") {
    errors[key] = "Enter text."

    return null
  }

  const normalized = value.trim()

  if (normalized.length > max) errors[key] = `Use ${max} characters or fewer.`

  return normalized || null
}

function requiredText(
  value: unknown,
  max: number,
  key: string,
  label: string,
  errors: Record<string, string>,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    errors[key] = `${label} is required.`

    return ""
  }

  const normalized = value.trim()

  if (normalized.length > max) errors[key] = `Use ${max} characters or fewer.`

  return normalized
}

function parseDealer(
  body: Record<string, unknown>,
  current?: DealerRow,
): DealerValues {
  const errors: Record<string, string> = {}

  const val = (key: string) =>
    body[key] === undefined && current
      ? current[
          ((({
            portalUserId: "portal_user_id",

            companyName: "company_name",

            contactName: "contact_name",

            businessRegistration: "business_registration",

            taxId: "tax_id",
          } as Record<string, string>)[key] ?? key) as keyof DealerRow)
        ]
      : body[key]

  const companyName = requiredText(
    val("companyName"),
    120,
    "companyName",
    "Company name",
    errors,
  )

  const contactName = requiredText(
    val("contactName"),
    120,
    "contactName",
    "Contact name",
    errors,
  )

  const phone = requiredText(val("phone"), 40, "phone", "Phone", errors)

  if (phone && !PHONE.test(phone)) errors.phone = "Enter a valid phone number."

  const email =
    optionalText(val("email"), 254, "email", errors)?.toLowerCase() ?? null

  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email address."

  const portalUserValue = val("portalUserId")

  const portalUserId =
    portalUserValue === null ||
    portalUserValue === "" ||
    portalUserValue === undefined
      ? null
      : typeof portalUserValue === "string"
        ? portalUserValue
        : null

  if (
    portalUserValue !== null &&
    portalUserValue !== "" &&
    portalUserValue !== undefined &&
    portalUserId === null
  )
    errors.portalUserId = "Choose a dealer portal account."

  const rawStatus = val("status") ?? "active"

  const status =
    rawStatus === "active" || rawStatus === "suspended" ? rawStatus : null

  if (!status) errors.status = "Choose a valid status."

  const values: DealerValues = {
    portalUserId,

    companyName,

    contactName,

    email,

    phone,

    businessRegistration: optionalText(
      val("businessRegistration"),
      80,
      "businessRegistration",
      errors,
    ),

    taxId: optionalText(val("taxId"), 80, "taxId", errors),

    address: optionalText(val("address"), 300, "address", errors),

    notes: optionalText(val("notes"), 1000, "notes", errors),

    status: status ?? "active",
  }

  if (Object.keys(errors).length)
    throw badRequest("Check the highlighted fields", errors)

  return values
}

function assertDealerPortalUser(tenantId: string, userId: string | null): void {
  if (!userId) return

  const user = get<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
      WHERE u.id = ? AND u.tenant_id = ? AND u.status IN ('active', 'invited')
        AND m.role_id = 'dealer_partner'`,

    userId,

    tenantId,
  )

  if (!user)
    throw badRequest(
      "Choose a dealer-partner portal account in this workspace.",
      { portalUserId: "Choose a valid dealer account." },
    )
}

function findDealerForUser(
  tenantId: string,
  userId: string,
): DealerRow | undefined {
  return get<DealerRow>(
    "SELECT * FROM dealers WHERE tenant_id = ? AND portal_user_id = ?",
    tenantId,
    userId,
  )
}

function canManageDealers(ctx: ReturnType<typeof requireAuth>): boolean {
  return ctx.can("dealers", "edit")
}

function dealerScope(
  ctx: ReturnType<typeof requireAuth>,
  dealerId: string,
): DealerRow {
  const dealer = get<DealerRow>(
    "SELECT * FROM dealers WHERE tenant_id = ? AND id = ?",
    ctx.tenantId,
    dealerId,
  )

  if (!dealer) throw notFound("That dealer does not exist")

  if (ctx.roleId === "dealer_partner" && dealer.portal_user_id !== ctx.userId)
    throw notFound("That dealer does not exist")

  return dealer
}

function toDealer(row: DealerSummaryRow) {
  return {
    id: row.id,

    portalUserId: row.portal_user_id,

    companyName: row.company_name,

    contactName: row.contact_name,

    email: row.email,

    phone: row.phone,

    businessRegistration: row.business_registration,

    taxId: row.tax_id,

    address: row.address,

    notes: row.notes,

    status: row.status,

    leadCount: row.lead_count,

    bookingCount: row.booking_count,

    commissionTotal: row.commission_total,

    commissionPaid: row.commission_paid,

    commissionPayable: row.commission_total - row.commission_paid,

    createdAt: row.created_at,

    updatedAt: row.updated_at,
  }
}

function listDealerSummaries(
  tenantId: string,
  dealerId?: string,
): DealerSummaryRow[] {
  return all<DealerSummaryRow>(
    `SELECT d.*,
            (SELECT count(*) FROM leads l WHERE l.tenant_id = d.tenant_id AND l.assigned_dealer_id = d.id) AS lead_count,
            (SELECT count(*) FROM dealer_bookings b WHERE b.tenant_id = d.tenant_id AND b.dealer_id = d.id) AS booking_count,
            (SELECT COALESCE(sum(b.commission_amount), 0) FROM dealer_bookings b
              WHERE b.tenant_id = d.tenant_id AND b.dealer_id = d.id AND b.status = 'confirmed') AS commission_total,
            (SELECT COALESCE(sum(p.amount), 0) FROM dealer_commission_payments p
              WHERE p.tenant_id = d.tenant_id AND p.dealer_id = d.id) AS commission_paid
       FROM dealers d
      WHERE d.tenant_id = ? AND (? IS NULL OR d.id = ?)
      ORDER BY d.company_name COLLATE NOCASE, d.contact_name COLLATE NOCASE`,

    tenantId,

    dealerId ?? null,

    dealerId ?? null,
  )
}

export async function listDealers(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "view")

  const onlySelf =
    guarded.roleId === "dealer_partner"
      ? findDealerForUser(guarded.tenantId, guarded.userId)?.id
      : undefined

  const rows = listDealerSummaries(guarded.tenantId, onlySelf)

  return {
    dealers: rows.map(toDealer),

    canManage: canManageDealers(guarded),

    canCreate: guarded.can("dealers", "create"),
  }
}

function portalUsers(tenantId: string): DealerListOptions[] {
  return all<DealerListOptions>(
    `SELECT u.id, u.full_name AS name, r.label AS type
       FROM users u JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
       JOIN roles r ON r.role_id = m.role_id
      WHERE u.tenant_id = ? AND u.status IN ('active', 'invited') AND m.role_id = 'dealer_partner'
      ORDER BY u.full_name COLLATE NOCASE`,

    tenantId,
  )
}

export async function createDealer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const values = parseDealer(body)

  assertDealerPortalUser(guarded.tenantId, values.portalUserId)

  const id = newId("dealer")

  const stamp = new Date().toISOString()

  try {
    run(
      `INSERT INTO dealers (
        id, tenant_id, portal_user_id, company_name, contact_name, email, phone,
        business_registration, tax_id, address, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,
      guarded.tenantId,
      values.portalUserId,
      values.companyName,
      values.contactName,

      values.email,
      values.phone,
      values.businessRegistration,
      values.taxId,
      values.address,

      values.notes,
      values.status,
      stamp,
      stamp,
    )
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict("That dealer portal user is already linked.", {
        portalUserId: "Choose an account not linked to another dealer.",
      })

    throw error
  }

  writeAudit(
    guarded,
    "dealer.created",
    "dealer",
    id,
    { companyName: values.companyName },
    ctx.ip,
  )

  return { dealer: listDealerSummaries(guarded.tenantId, id).map(toDealer)[0] }
}

export async function getDealer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "view")

  const dealerId = ctx.params.id

  if (!dealerId) throw notFound("That dealer does not exist")

  const dealer = dealerScope(guarded, dealerId)

  const summary = listDealerSummaries(guarded.tenantId, dealerId)[0]

  if (!summary) throw notFound("That dealer does not exist")

  const leads = all<DealerLeadRow>(
    `SELECT l.id, l.full_name, l.phone, l.email, l.project_interest, l.status,
            COALESCE(s.label, l.status) AS status_label, u.full_name AS assigned_agent_name, l.created_at
       FROM leads l
       LEFT JOIN lead_stages s ON s.tenant_id = l.tenant_id AND s.stage_key = l.status
       LEFT JOIN users u ON u.id = l.assigned_agent_id AND u.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.assigned_dealer_id = ?
      ORDER BY l.created_at DESC`,

    guarded.tenantId,

    dealerId,
  )

  const unassignedLeads = canManageDealers(guarded)
    ? all<DealerLeadRow>(
        `SELECT l.id, l.full_name, l.phone, l.email, l.project_interest, l.status,
            COALESCE(s.label, l.status) AS status_label, u.full_name AS assigned_agent_name, l.created_at
       FROM leads l
       LEFT JOIN lead_stages s ON s.tenant_id = l.tenant_id AND s.stage_key = l.status
       LEFT JOIN users u ON u.id = l.assigned_agent_id AND u.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.assigned_dealer_id IS NULL
      ORDER BY l.created_at DESC LIMIT 100`,

        guarded.tenantId,
      )
    : []

  const rules = all<CommissionRuleRow>(
    `SELECT r.id, r.dealer_id, r.scope, r.project_id, p.name AS project_name,
            r.unit_type, r.commission_type, r.commission_value
       FROM dealer_commission_rules r
       LEFT JOIN projects p ON p.id = r.project_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.dealer_id = ?
      ORDER BY r.scope, COALESCE(p.name, r.unit_type), r.id`,

    guarded.tenantId,

    dealerId,
  )

  const bookings = all<DealerBookingRow>(
    `SELECT b.id, b.booking_reference, b.customer_name, b.project_id, p.name AS project_name,
            b.unit_type, b.booking_amount, b.booking_date, b.status,
            b.commission_type, b.commission_value, b.commission_amount,
            (SELECT COALESCE(sum(cp.amount), 0) FROM dealer_commission_payments cp
              WHERE cp.tenant_id = b.tenant_id AND cp.booking_id = b.id) AS paid_amount
       FROM dealer_bookings b JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? AND b.dealer_id = ?
      ORDER BY b.booking_date DESC, b.created_at DESC`,

    guarded.tenantId,

    dealerId,
  )

  const projects = all<DealerProjectOption>(
    "SELECT id, name, (SELECT currency FROM tenants WHERE id = projects.tenant_id) AS currency FROM projects WHERE tenant_id = ? ORDER BY name COLLATE NOCASE",

    guarded.tenantId,
  )

  const portalUser = dealer.portal_user_id
    ? get<DealerPortalUserRow>(
        "SELECT id, full_name AS name FROM users WHERE tenant_id = ? AND id = ?",

        guarded.tenantId,

        dealer.portal_user_id,
      )
    : undefined

  const statement = bookings
    .filter((booking) => booking.status === "confirmed")
    .map((booking) => ({
      bookingId: booking.id,

      reference: booking.booking_reference,

      customerName: booking.customer_name,

      projectName: booking.project_name,

      bookingDate: booking.booking_date,

      commissionType: booking.commission_type,

      commissionValue: booking.commission_value,

      commissionAmount: booking.commission_amount,

      paidAmount: booking.paid_amount,

      payable: (booking.commission_amount ?? 0) - booking.paid_amount,
    }))

  return {
    dealer: { ...toDealer(summary), portalUserName: portalUser?.name ?? null },

    leads: leads.map(toDealerLead),

    unassignedLeads: unassignedLeads.map(toDealerLead),

    bookings: bookings.map((booking) => ({
      ...booking,
      bookingAmount: booking.booking_amount,
      bookingDate: booking.booking_date,
      bookingReference: booking.booking_reference,
      customerName: booking.customer_name,
      projectName: booking.project_name,
      commissionType: booking.commission_type,
      commissionValue: booking.commission_value,
      commissionAmount: booking.commission_amount,
      paidAmount: booking.paid_amount,
    })),

    rules: rules.map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      projectId: rule.project_id,
      projectName: rule.project_name,
      unitType: rule.unit_type,
      commissionType: rule.commission_type,
      commissionValue: rule.commission_value,
    })),

    projects,

    portalUsers: canManageDealers(guarded) ? portalUsers(guarded.tenantId) : [],

    statement: {
      entries: statement,

      totalCommission: statement.reduce(
        (sum, entry) => sum + (entry.commissionAmount ?? 0),
        0,
      ),

      totalPaid: statement.reduce((sum, entry) => sum + entry.paidAmount, 0),

      totalPayable: statement.reduce((sum, entry) => sum + entry.payable, 0),
    },

    canManage: canManageDealers(guarded),

    canManageBookings: guarded.can("bookings", "approve"),

    canCreateBookings: guarded.can("bookings", "create"),
  }
}

function toDealerLead(lead: DealerLeadRow) {
  return {
    id: lead.id,

    name: lead.full_name,

    phone: lead.phone,

    email: lead.email,

    projectInterest: lead.project_interest,

    status: lead.status,

    statusLabel: lead.status_label,

    assignedAgentName: lead.assigned_agent_name,

    createdAt: lead.created_at,
  }
}

export async function updateDealer(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "edit")

  const id = ctx.params.id

  if (!id) throw notFound("That dealer does not exist")

  const existing = get<DealerRow>(
    "SELECT * FROM dealers WHERE tenant_id = ? AND id = ?",
    guarded.tenantId,
    id,
  )

  if (!existing) throw notFound("That dealer does not exist")

  const values = parseDealer(
    await readJsonBody<Record<string, unknown>>(ctx.req),
    existing,
  )

  assertDealerPortalUser(guarded.tenantId, values.portalUserId)

  try {
    run(
      `UPDATE dealers SET portal_user_id = ?, company_name = ?, contact_name = ?, email = ?, phone = ?,
       business_registration = ?, tax_id = ?, address = ?, notes = ?, status = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,

      values.portalUserId,
      values.companyName,
      values.contactName,
      values.email,
      values.phone,

      values.businessRegistration,
      values.taxId,
      values.address,
      values.notes,
      values.status,

      new Date().toISOString(),
      guarded.tenantId,
      id,
    )
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict("That dealer portal user is already linked.", {
        portalUserId: "Choose an account not linked to another dealer.",
      })

    throw error
  }

  writeAudit(
    guarded,
    "dealer.updated",
    "dealer",
    id,
    { companyName: values.companyName },
    ctx.ip,
  )

  return { dealer: listDealerSummaries(guarded.tenantId, id).map(toDealer)[0] }
}

export async function assignDealerLead(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "edit")

  const dealerId = ctx.params.id

  const leadId = ctx.params.leadId

  if (!dealerId || !leadId) throw notFound("That lead or dealer does not exist")

  dealerScope(guarded, dealerId)

  const lead = get<LeadAssignmentRow>(
    "SELECT id, assigned_dealer_id FROM leads WHERE tenant_id = ? AND id = ?",

    guarded.tenantId,

    leadId,
  )

  if (!lead) throw notFound("That lead does not exist")

  if (lead.assigned_dealer_id && lead.assigned_dealer_id !== dealerId)
    throw conflict("This lead is already assigned to another dealer.")

  run(
    "UPDATE leads SET assigned_dealer_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
    dealerId,
    new Date().toISOString(),
    guarded.tenantId,
    leadId,
  )

  writeAudit(
    guarded,
    "lead.dealer_assigned",
    "lead",
    leadId,
    { dealerId },
    ctx.ip,
  )

  return { ok: true }
}

export async function unassignDealerLead(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "edit")

  const dealerId = ctx.params.id

  const leadId = ctx.params.leadId

  if (!dealerId || !leadId) throw notFound("That lead or dealer does not exist")

  dealerScope(guarded, dealerId)

  const lead = get<{ id: string }>(
    "SELECT id FROM leads WHERE tenant_id = ? AND id = ? AND assigned_dealer_id = ?",
    guarded.tenantId,
    leadId,
    dealerId,
  )

  if (!lead) throw notFound("That lead does not exist")

  run(
    "UPDATE leads SET assigned_dealer_id = NULL, updated_at = ? WHERE tenant_id = ? AND id = ?",
    new Date().toISOString(),
    guarded.tenantId,
    leadId,
  )

  writeAudit(
    guarded,
    "lead.dealer_unassigned",
    "lead",
    leadId,
    { dealerId },
    ctx.ip,
  )

  return { ok: true }
}

function parseCommissionRule(
  body: Record<string, unknown>,
  tenantId: string,
): DealerRuleInput {
  const scope = body.scope

  if (scope !== "project" && scope !== "unit_type")
    throw badRequest("Choose a rule scope.", {
      scope: "Choose project or unit type.",
    })

  const commissionType = body.commissionType

  if (commissionType !== "percentage" && commissionType !== "fixed")
    throw badRequest("Choose a commission type.", {
      commissionType: "Choose percentage or fixed.",
    })

  const value = body.commissionValue

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (commissionType === "percentage" && value > 100) ||
    (commissionType === "fixed" && !Number.isSafeInteger(value))
  ) {
    throw badRequest("Enter a valid commission value.", {
      commissionValue:
        commissionType === "percentage"
          ? "Enter a percentage greater than zero and at most 100."
          : "Enter a whole fixed amount greater than zero.",
    })
  }

  const projectId =
    scope === "project" && typeof body.projectId === "string"
      ? body.projectId
      : null

  const unitType =
    scope === "unit_type" && isUnitType(body.unitType) ? body.unitType : null

  if (scope === "project" && !projectId)
    throw badRequest("Select a project.", { projectId: "Select a project." })

  if (scope === "unit_type" && !unitType)
    throw badRequest("Select a unit type.", { unitType: "Select a unit type." })

  if (
    projectId &&
    !get(
      "SELECT id FROM projects WHERE tenant_id = ? AND id = ?",
      tenantId,
      projectId,
    )
  )
    throw notFound("That project does not exist")

  return { scope, projectId, unitType, commissionType, commissionValue: value }
}

export async function createCommissionRule(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "edit")

  const dealerId = ctx.params.id

  if (!dealerId) throw notFound("That dealer does not exist")

  dealerScope(guarded, dealerId)

  const rule = parseCommissionRule(
    await readJsonBody<Record<string, unknown>>(ctx.req),
    guarded.tenantId,
  )

  const id = newId("dcr")

  const stamp = new Date().toISOString()

  try {
    run(
      `INSERT INTO dealer_commission_rules (
        id, tenant_id, dealer_id, scope, project_id, unit_type, commission_type,
        commission_value, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,
      guarded.tenantId,
      dealerId,
      rule.scope,
      rule.projectId,
      rule.unitType,

      rule.commissionType,
      rule.commissionValue,
      stamp,
      stamp,
    )
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(
        "A commission rule already exists for that project or unit type.",
      )

    throw error
  }

  writeAudit(
    guarded,
    "dealer.commission_rule_created",
    "dealer",
    dealerId,
    rule as Record<string, unknown>,
    ctx.ip,
  )

  return { id, ...rule }
}

export async function updateCommissionRule(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "edit")

  const dealerId = ctx.params.id

  const ruleId = ctx.params.ruleId

  if (!dealerId || !ruleId)
    throw notFound("That commission rule does not exist")

  dealerScope(guarded, dealerId)

  const existing = get<{
    id: string
    scope: string
    project_id: string | null
    unit_type: string | null
    commission_type: string
    commission_value: number
  }>(
    "SELECT id, scope, project_id, unit_type, commission_type, commission_value FROM dealer_commission_rules WHERE tenant_id = ? AND dealer_id = ? AND id = ?",

    guarded.tenantId,
    dealerId,
    ruleId,
  )

  if (!existing) throw notFound("That commission rule does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const rule = parseCommissionRule(
    {
      scope: body.scope ?? existing.scope,

      projectId:
        body.projectId === undefined ? existing.project_id : body.projectId,

      unitType:
        body.unitType === undefined ? existing.unit_type : body.unitType,

      commissionType: body.commissionType ?? existing.commission_type,

      commissionValue: body.commissionValue ?? existing.commission_value,
    },
    guarded.tenantId,
  )

  try {
    run(
      `UPDATE dealer_commission_rules SET scope = ?, project_id = ?, unit_type = ?,
       commission_type = ?, commission_value = ?, updated_at = ?
       WHERE tenant_id = ? AND dealer_id = ? AND id = ?`,

      rule.scope,
      rule.projectId,
      rule.unitType,
      rule.commissionType,
      rule.commissionValue,

      new Date().toISOString(),
      guarded.tenantId,
      dealerId,
      ruleId,
    )
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(
        "A commission rule already exists for that project or unit type.",
      )

    throw error
  }

  writeAudit(
    guarded,
    "dealer.commission_rule_updated",
    "dealer",
    dealerId,
    { ruleId, ...rule },
    ctx.ip,
  )

  return { id: ruleId, ...rule }
}

export async function deleteCommissionRule(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "edit")

  const dealerId = ctx.params.id

  const ruleId = ctx.params.ruleId

  if (!dealerId || !ruleId)
    throw notFound("That commission rule does not exist")

  dealerScope(guarded, dealerId)

  const used = get<{ count: number }>(
    "SELECT count(*) AS count FROM dealer_bookings WHERE tenant_id = ? AND dealer_id = ? AND commission_rule_id = ?",
    guarded.tenantId,
    dealerId,
    ruleId,
  )

  if ((used?.count ?? 0) > 0)
    throw conflict(
      "This rule is referenced by confirmed bookings and cannot be deleted.",
    )

  const result = get<{ id: string }>(
    "SELECT id FROM dealer_commission_rules WHERE tenant_id = ? AND dealer_id = ? AND id = ?",
    guarded.tenantId,
    dealerId,
    ruleId,
  )

  if (!result) throw notFound("That commission rule does not exist")

  run(
    "DELETE FROM dealer_commission_rules WHERE tenant_id = ? AND dealer_id = ? AND id = ?",
    guarded.tenantId,
    dealerId,
    ruleId,
  )

  writeAudit(
    guarded,
    "dealer.commission_rule_deleted",
    "dealer",
    dealerId,
    { ruleId },
    ctx.ip,
  )

  return { ok: true }
}

function dealerBookingPermission(
  ctx: ReturnType<typeof requireAuth>,
  dealer: DealerRow,
  action: "create" | "edit",
): void {
  if (ctx.roleId === "dealer_partner") {
    if (dealer.portal_user_id !== ctx.userId)
      throw notFound("That dealer does not exist")

    requirePermission(ctx, "bookings", action)

    return
  }

  requirePermission(ctx, "dealers", "edit")
}

function projectForBooking(
  tenantId: string,
  projectId: string,
): ProjectForBooking {
  const project = get<ProjectForBooking>(
    "SELECT id, name FROM projects WHERE tenant_id = ? AND id = ?",
    tenantId,
    projectId,
  )

  if (!project) throw notFound("That project does not exist")

  return project
}

function readDealerBooking(
  body: Record<string, unknown>,
  tenantId: string,
): DealerBookingCreateResult {
  const errors: Record<string, string> = {}

  const reference = requiredText(
    body.bookingReference,
    48,
    "bookingReference",
    "Booking reference",
    errors,
  )

  const customerName = requiredText(
    body.customerName,
    120,
    "customerName",
    "Customer name",
    errors,
  )

  const projectId = typeof body.projectId === "string" ? body.projectId : ""

  const unitType = isUnitType(body.unitType) ? body.unitType : null

  if (!projectId) errors.projectId = "Select a project."

  if (!unitType) errors.unitType = "Select a unit type."

  const amount = body.bookingAmount

  const bookingAmount =
    typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0
      ? amount
      : null

  if (bookingAmount === null)
    errors.bookingAmount = "Enter a whole amount of zero or more."

  const bookingDate =
    typeof body.bookingDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.bookingDate)
      ? body.bookingDate
      : ""

  if (
    !bookingDate ||
    Number.isNaN(new Date(`${bookingDate}T00:00:00Z`).valueOf())
  )
    errors.bookingDate = "Enter a valid booking date."

  const leadValue = body.leadId

  const leadId =
    leadValue === null || leadValue === undefined || leadValue === ""
      ? null
      : typeof leadValue === "string"
        ? leadValue
        : null

  if (leadValue && !leadId) errors.leadId = "Choose a valid lead."

  if (Object.keys(errors).length)
    throw badRequest("Check the highlighted fields", errors)

  projectForBooking(tenantId, projectId)

  if (
    leadId &&
    !get(
      "SELECT id FROM leads WHERE tenant_id = ? AND id = ?",
      tenantId,
      leadId,
    )
  )
    throw notFound("That lead does not exist")

  return {
    reference,
    customerName,
    projectId,
    unitType: unitType!,
    bookingAmount: bookingAmount!,
    bookingDate,
    leadId,
  }
}

export async function createDealerBooking(ctx: RequestContext) {
  const guarded = requireAnyPermission(requireAuth(ctx), "bookings", ["create"])

  const dealerId = ctx.params.id

  if (!dealerId) throw notFound("That dealer does not exist")

  const dealer = dealerScope(guarded, dealerId)

  dealerBookingPermission(guarded, dealer, "create")

  if (dealer.status !== "active")
    throw conflict("Bookings cannot be added for a suspended dealer.")

  const values = readDealerBooking(
    await readJsonBody<Record<string, unknown>>(ctx.req),
    guarded.tenantId,
  )

  if (values.leadId) {
    const lead = get<Pick<LeadAssignmentRow, "assigned_dealer_id">>(
      "SELECT assigned_dealer_id FROM leads WHERE tenant_id = ? AND id = ?",
      guarded.tenantId,
      values.leadId,
    )

    if (lead?.assigned_dealer_id && lead.assigned_dealer_id !== dealerId)
      throw conflict("The selected lead is assigned to another dealer.")

    if (!lead?.assigned_dealer_id)
      run(
        "UPDATE leads SET assigned_dealer_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
        dealerId,
        new Date().toISOString(),
        guarded.tenantId,
        values.leadId,
      )
  }

  const id = newId("dbk")

  const stamp = new Date().toISOString()

  try {
    run(
      `INSERT INTO dealer_bookings (
        id, tenant_id, dealer_id, lead_id, booking_reference, customer_name, project_id,
        unit_type, booking_amount, booking_date, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,

      id,
      guarded.tenantId,
      dealerId,
      values.leadId,
      values.reference,
      values.customerName,

      values.projectId,
      values.unitType,
      values.bookingAmount,
      values.bookingDate,

      guarded.userId,
      stamp,
      stamp,
    )
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict("That booking reference is already recorded.", {
        bookingReference: "Choose a unique reference.",
      })

    throw error
  }

  writeAudit(
    guarded,
    "dealer.booking_submitted",
    "dealer_booking",
    id,
    { dealerId, reference: values.reference },
    ctx.ip,
  )

  return { bookingId: id, status: "pending" }
}

function matchingRule(
  tenantId: string,
  dealerId: string,
  projectId: string,
  unitType: UnitType,
): CommissionRuleRow | undefined {
  return get<CommissionRuleRow>(
    `SELECT r.id, r.dealer_id, r.scope, r.project_id, p.name AS project_name,
            r.unit_type, r.commission_type, r.commission_value
       FROM dealer_commission_rules r
       LEFT JOIN projects p ON p.id = r.project_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.dealer_id = ?
        AND ((r.scope = 'project' AND r.project_id = ?) OR (r.scope = 'unit_type' AND r.unit_type = ?))
      ORDER BY CASE r.scope WHEN 'project' THEN 0 ELSE 1 END LIMIT 1`,

    tenantId,

    dealerId,

    projectId,

    unitType,
  )
}

export async function updateDealerBooking(ctx: RequestContext) {
  const guarded = requireAnyPermission(requireAuth(ctx), "bookings", [
    "approve",
  ])

  const dealerId = ctx.params.id

  const bookingId = ctx.params.bookingId

  if (!dealerId || !bookingId)
    throw notFound("That dealer booking does not exist")

  const dealer = dealerScope(guarded, dealerId)

  dealerBookingPermission(guarded, dealer, "edit")

  const booking = get<{
    id: string
    project_id: string
    unit_type: UnitType
    booking_amount: number
    status: string
  }>(
    "SELECT id, project_id, unit_type, booking_amount, status FROM dealer_bookings WHERE tenant_id = ? AND dealer_id = ? AND id = ?",

    guarded.tenantId,
    dealerId,
    bookingId,
  )

  if (!booking) throw notFound("That dealer booking does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  if (body.status !== "confirmed" && body.status !== "cancelled")
    throw badRequest("Choose Confirmed or Cancelled.", {
      status: "Choose a valid booking status.",
    })

  if (booking.status !== "pending")
    throw conflict("Only pending dealer bookings can be reviewed.")

  let commissionRule: CommissionRuleRow | undefined

  let commissionAmount: number | null = null

  if (body.status === "confirmed") {
    commissionRule = matchingRule(
      guarded.tenantId,
      dealerId,
      booking.project_id,
      booking.unit_type,
    )

    if (!commissionRule)
      throw conflict("No commission rule matches this project's unit type.")

    commissionAmount =
      commissionRule.commission_type === "percentage"
        ? Math.round(
            (booking.booking_amount * commissionRule.commission_value) / 100,
          )
        : Math.round(commissionRule.commission_value)
  }

  run(
    `UPDATE dealer_bookings SET status = ?, commission_rule_id = ?, commission_type = ?,
      commission_value = ?, commission_amount = ?, updated_at = ?
      WHERE tenant_id = ? AND dealer_id = ? AND id = ?`,

    body.status,
    commissionRule?.id ?? null,
    commissionRule?.commission_type ?? null,

    commissionRule?.commission_value ?? null,
    commissionAmount,
    new Date().toISOString(),

    guarded.tenantId,
    dealerId,
    bookingId,
  )

  writeAudit(
    guarded,
    `dealer.booking_${body.status}`,
    "dealer_booking",
    bookingId,
    { dealerId, commissionAmount },
    ctx.ip,
  )

  return { status: body.status, commissionAmount }
}

export async function payDealerCommission(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "dealers", "edit")

  const dealerId = ctx.params.id

  const bookingId = ctx.params.bookingId

  if (!dealerId || !bookingId)
    throw notFound("That commission entry does not exist")

  dealerScope(guarded, dealerId)

  const booking = get<DealerBookingStatusRow>(
    "SELECT commission_amount, status FROM dealer_bookings WHERE tenant_id = ? AND dealer_id = ? AND id = ?",

    guarded.tenantId,
    dealerId,
    bookingId,
  )

  if (
    !booking ||
    booking.status !== "confirmed" ||
    booking.commission_amount === null
  )
    throw notFound("That commission entry does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const amount = body.amount

  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  )
    throw badRequest("Enter a payout amount greater than zero.", {
      amount: "Enter a whole amount greater than zero.",
    })

  const paid =
    get<{ amount: number }>(
      "SELECT COALESCE(sum(amount), 0) AS amount FROM dealer_commission_payments WHERE tenant_id = ? AND dealer_id = ? AND booking_id = ?",
      guarded.tenantId,
      dealerId,
      bookingId,
    )?.amount ?? 0

  if (amount > booking.commission_amount - paid)
    throw conflict(
      "Payout exceeds this booking's remaining commission payable.",
      { amount: "Enter no more than the remaining payable amount." },
    )

  const paidOn =
    typeof body.paidOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn)
      ? body.paidOn
      : new Date().toISOString().slice(0, 10)

  const note = optionalText(body.note, 240, "note", {})

  const id = newId("dcp")

  const stamp = new Date().toISOString()

  run(
    `INSERT INTO dealer_commission_payments (
      id, tenant_id, dealer_id, booking_id, amount, paid_on, note, recorded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,
    guarded.tenantId,
    dealerId,
    bookingId,
    amount,
    paidOn,
    note,
    guarded.userId,
    stamp,
  )

  writeAudit(
    guarded,
    "dealer.commission_paid",
    "dealer_commission_payment",
    id,
    { dealerId, bookingId, amount },
    ctx.ip,
  )

  return { id, amount, paidOn }
}
