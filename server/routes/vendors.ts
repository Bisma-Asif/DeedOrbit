/**
 * The vendors module: supplier profile, contracts, invoices, payments, and the
 * running vendor ledger.
 *
 * A vendor's account is a payable, so its ledger uses the same signed shape the
 * customer ledger uses but the opposite reading: a positive row raises what we
 * owe the vendor (an invoice landed), a negative row pays it down. Balance is
 * never stored on the row — the read folds a running sum, ordered by
 * `(occurred_at, rowid)`, so the trail the client sees is the trail the rows
 * describe.
 *
 * Voiding an invoice is not a delete: it writes an equal-and-opposite adjustment
 * so the running balance stays honest and the original event remains auditable.
 * Recording a payment against a specific invoice flips that invoice to `paid`
 * when the total paid meets the invoice amount; a partial payment leaves it
 * `open` with the ledger carrying both rows.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import {
  VENDOR_ADDRESS_MAX,
  VENDOR_CITY_MAX,
  VENDOR_COUNTRY_MAX,
  VENDOR_CONTRACT_NOTES_MAX,
  VENDOR_CONTRACT_REFERENCE_MAX,
  VENDOR_CONTRACT_TITLE_MAX,
  VENDOR_CONTACT_MAX,
  VENDOR_EMAIL_MAX,
  VENDOR_INVOICE_AMOUNT_MAX,
  VENDOR_INVOICE_REFERENCE_MAX,
  VENDOR_LEDGER_NOTE_MAX,
  VENDOR_NAME_MAX,
  VENDOR_NOTES_MAX,
  VENDOR_PHONE_MAX,
  VENDOR_TAX_ID_MAX,
  isVendorContractStatus,
  isVendorInvoiceStatus,
  isVendorLedgerKind,
  isVendorStatus,
  type Vendor,
  type VendorContract,
  type VendorContractStatus,
  type VendorInvoice,
  type VendorInvoiceStatus,
  type VendorLedgerEntry,
  type VendorLedgerKind,
  type VendorStatus,
} from "../../shared/vendors.ts"

const now = () => new Date().toISOString()

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}

// --- Vendor rows -----------------------------------------------------------

interface VendorRow {
  id: string

  tenant_id: string

  name: string

  contact_name: string | null

  email: string | null

  phone: string | null

  tax_id: string | null

  address_line1: string | null

  address_line2: string | null

  city: string | null

  country_code: string | null

  notes: string | null

  status: string

  created_at: string

  updated_at: string
}

interface VendorJoinedRow extends VendorRow {
  balance: number

  contract_count: number

  open_invoice_count: number
}

function toVendor(row: VendorJoinedRow): Vendor {
  return {
    id: row.id,

    name: row.name,

    contactName: row.contact_name,

    email: row.email,

    phone: row.phone,

    taxId: row.tax_id,

    addressLine1: row.address_line1,

    addressLine2: row.address_line2,

    city: row.city,

    countryCode: row.country_code,

    notes: row.notes,

    status: row.status as VendorStatus,

    createdAt: row.created_at,

    updatedAt: row.updated_at,

    balance: row.balance,

    currency: tenantCurrency(row.tenant_id),

    contractCount: row.contract_count,

    openInvoiceCount: row.open_invoice_count,
  }
}

const VENDOR_SELECT = `
  SELECT v.*,
         COALESCE((SELECT SUM(amount) FROM vendor_ledger_entries l
                     WHERE l.tenant_id = v.tenant_id AND l.vendor_id = v.id), 0) AS balance,
         (SELECT COUNT(*) FROM vendor_contracts c
                     WHERE c.tenant_id = v.tenant_id AND c.vendor_id = v.id) AS contract_count,
         (SELECT COUNT(*) FROM vendor_invoices i
                     WHERE i.tenant_id = v.tenant_id AND i.vendor_id = v.id AND i.status = 'open') AS open_invoice_count
    FROM vendors v
`

function loadVendorJoined(
  tenantId: string,
  id: string,
): VendorJoinedRow | undefined {
  return get<VendorJoinedRow>(
    `${VENDOR_SELECT} WHERE v.tenant_id = ? AND v.id = ?`,
    tenantId,
    id,
  )
}

/** GET /api/vendors */

export async function listVendors(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "view")

  const search = (ctx.query.get("search") ?? "").trim().toLowerCase()

  const status = ctx.query.get("status") ?? ""

  const clauses: string[] = ["v.tenant_id = ?"]

  const params: Array<string | number> = [guarded.tenantId]

  if (status && isVendorStatus(status)) {
    clauses.push("v.status = ?")

    params.push(status)
  }

  if (search) {
    clauses.push("LOWER(v.name) LIKE ?")

    params.push(`%${search}%`)
  }

  const rows = all<VendorJoinedRow>(
    `${VENDOR_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY v.name COLLATE NOCASE ASC`,

    ...params,
  )

  return {
    vendors: rows.map(toVendor),

    currency: tenantCurrency(guarded.tenantId),

    canCreate: guarded.can("vendors", "create"),

    canEdit: guarded.can("vendors", "edit"),
  }
}

/** POST /api/vendors */

export async function createVendor(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name === "") errors.name = "Give this vendor a name."
  else if (name.length > VENDOR_NAME_MAX)
    errors.name = `Use ${VENDOR_NAME_MAX} characters or fewer.`

  const contactName = bounded(
    body.contactName,
    VENDOR_CONTACT_MAX,
    "contactName",
    errors,
  )

  const email = bounded(body.email, VENDOR_EMAIL_MAX, "email", errors)

  const phone = bounded(body.phone, VENDOR_PHONE_MAX, "phone", errors)

  const taxId = bounded(body.taxId, VENDOR_TAX_ID_MAX, "taxId", errors)

  const addressLine1 = bounded(
    body.addressLine1,
    VENDOR_ADDRESS_MAX,
    "addressLine1",
    errors,
  )

  const addressLine2 = bounded(
    body.addressLine2,
    VENDOR_ADDRESS_MAX,
    "addressLine2",
    errors,
  )

  const city = bounded(body.city, VENDOR_CITY_MAX, "city", errors)

  const countryCode = bounded(
    body.countryCode,
    VENDOR_COUNTRY_MAX,
    "countryCode",
    errors,
  )

  const notes = bounded(body.notes, VENDOR_NOTES_MAX, "notes", errors)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const duplicate = get<{ id: string }>(
    `SELECT id FROM vendors WHERE tenant_id = ? AND name = ? COLLATE NOCASE`,

    guarded.tenantId,

    name,
  )

  if (duplicate) {
    throw badRequest("A vendor with that name already exists.", {
      name: "Pick a different name or edit the existing vendor.",
    })
  }

  const id = `ven_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO vendors (
        id, tenant_id, name, contact_name, email, phone, tax_id,
        address_line1, address_line2, city, country_code, notes,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,

    id,

    guarded.tenantId,

    name,

    contactName,

    email,

    phone,

    taxId,

    addressLine1,

    addressLine2,

    city,

    countryCode,

    notes,

    stamp,

    stamp,
  )

  writeAudit(guarded, "vendor.created", "vendor", id, { name }, ctx.ip)

  const row = loadVendorJoined(guarded.tenantId, id)!

  return { vendor: toVendor(row) }
}

function bounded(
  value: unknown,

  max: number,

  field: string,

  errors: Record<string, string>,
): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()

  if (trimmed === "") return null

  if (trimmed.length > max) {
    errors[field] = `Use ${max} characters or fewer.`

    return null
  }

  return trimmed
}

/** GET /api/vendors/:id */

export async function getVendor(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "view")

  const row = loadVendorJoined(guarded.tenantId, ctx.params.id!)

  if (!row) throw notFound("That vendor does not exist")

  return {
    vendor: toVendor(row),

    canEdit: guarded.can("vendors", "edit"),

    canCreate: guarded.can("vendors", "create"),
  }
}

/** PATCH /api/vendors/:id */

export async function updateVendor(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "edit")

  const existing = get<VendorRow>(
    `SELECT * FROM vendors WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!existing) throw notFound("That vendor does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name = typeof body.name === "string" ? body.name.trim() : existing.name

  if (name === "") errors.name = "Give this vendor a name."
  else if (name.length > VENDOR_NAME_MAX)
    errors.name = `Use ${VENDOR_NAME_MAX} characters or fewer.`

  const contactName = bounded(
    body.contactName,
    VENDOR_CONTACT_MAX,
    "contactName",
    errors,
  )

  const email = bounded(body.email, VENDOR_EMAIL_MAX, "email", errors)

  const phone = bounded(body.phone, VENDOR_PHONE_MAX, "phone", errors)

  const taxId = bounded(body.taxId, VENDOR_TAX_ID_MAX, "taxId", errors)

  const addressLine1 = bounded(
    body.addressLine1,
    VENDOR_ADDRESS_MAX,
    "addressLine1",
    errors,
  )

  const addressLine2 = bounded(
    body.addressLine2,
    VENDOR_ADDRESS_MAX,
    "addressLine2",
    errors,
  )

  const city = bounded(body.city, VENDOR_CITY_MAX, "city", errors)

  const countryCode = bounded(
    body.countryCode,
    VENDOR_COUNTRY_MAX,
    "countryCode",
    errors,
  )

  const notes = bounded(body.notes, VENDOR_NOTES_MAX, "notes", errors)

  const statusRaw =
    typeof body.status === "string" ? body.status : existing.status

  if (!isVendorStatus(statusRaw)) errors.status = "Unknown vendor status."

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const clash = get<{ id: string }>(
    `SELECT id FROM vendors
      WHERE tenant_id = ? AND id != ? AND name = ? COLLATE NOCASE`,

    guarded.tenantId,

    existing.id,

    name,
  )

  if (clash) {
    throw badRequest("Another vendor already uses that name.", {
      name: "Pick a different name.",
    })
  }

  run(
    `UPDATE vendors
        SET name = ?, contact_name = ?, email = ?, phone = ?, tax_id = ?,
            address_line1 = ?, address_line2 = ?, city = ?, country_code = ?,
            notes = ?, status = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    name,

    contactName,

    email,

    phone,

    taxId,

    addressLine1,

    addressLine2,

    city,

    countryCode,

    notes,

    statusRaw,

    now(),

    guarded.tenantId,

    existing.id,
  )

  writeAudit(guarded, "vendor.updated", "vendor", existing.id, null, ctx.ip)

  const row = loadVendorJoined(guarded.tenantId, existing.id)!

  return { vendor: toVendor(row) }
}

// --- Contracts -------------------------------------------------------------

interface ContractRow {
  id: string

  tenant_id: string

  vendor_id: string

  reference: string

  title: string

  value: number

  currency: string

  start_date: string | null

  end_date: string | null

  notes: string | null

  status: string

  created_at: string
}

function toContract(row: ContractRow): VendorContract {
  return {
    id: row.id,

    vendorId: row.vendor_id,

    reference: row.reference,

    title: row.title,

    value: row.value,

    currency: row.currency,

    startDate: row.start_date,

    endDate: row.end_date,

    notes: row.notes,

    status: row.status as VendorContractStatus,

    createdAt: row.created_at,
  }
}

/** A minimal vendor existence/read-back keyed on the tenant. */
interface VendorRef {
  id: string
  tenant_id: string
}

/** GET /api/vendors/:id/contracts */

export async function listVendorContracts(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "view")

  const vendor = get<VendorRef>(
    `SELECT id, tenant_id FROM vendors WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!vendor) throw notFound("That vendor does not exist")

  const rows = all<ContractRow>(
    `SELECT * FROM vendor_contracts WHERE tenant_id = ? AND vendor_id = ?
      ORDER BY created_at DESC, rowid DESC`,

    guarded.tenantId,

    vendor.id,
  )

  return {
    contracts: rows.map(toContract),
    canEdit: guarded.can("vendors", "edit"),
  }
}

/** POST /api/vendors/:id/contracts */

export async function createVendorContract(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "edit")

  const vendor = get<VendorRef>(
    `SELECT id, tenant_id FROM vendors WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!vendor) throw notFound("That vendor does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const reference =
    typeof body.reference === "string" ? body.reference.trim() : ""

  if (reference === "") errors.reference = "Give the contract a reference."
  else if (reference.length > VENDOR_CONTRACT_REFERENCE_MAX) {
    errors.reference = `Use ${VENDOR_CONTRACT_REFERENCE_MAX} characters or fewer.`
  }

  const title = typeof body.title === "string" ? body.title.trim() : ""

  if (title === "") errors.title = "Give the contract a title."
  else if (title.length > VENDOR_CONTRACT_TITLE_MAX) {
    errors.title = `Use ${VENDOR_CONTRACT_TITLE_MAX} characters or fewer.`
  }

  const amount =
    typeof body.value === "number" &&
    Number.isSafeInteger(body.value) &&
    body.value >= 0 &&
    body.value <= VENDOR_INVOICE_AMOUNT_MAX
      ? body.value
      : 0

  if (
    body.value !== undefined &&
    !(
      typeof body.value === "number" &&
      Number.isSafeInteger(body.value) &&
      body.value >= 0 &&
      body.value <= VENDOR_INVOICE_AMOUNT_MAX
    )
  ) {
    errors.value = `Enter a whole number from 0 to ${VENDOR_INVOICE_AMOUNT_MAX}.`
  }

  const startDate = optionalDate(body.startDate, "startDate", errors)

  const endDate = optionalDate(body.endDate, "endDate", errors)

  const notes = bounded(body.notes, VENDOR_CONTRACT_NOTES_MAX, "notes", errors)

  const statusRaw = typeof body.status === "string" ? body.status : "active"

  if (!isVendorContractStatus(statusRaw))
    errors.status = "Unknown contract status."

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const clash = get<{ id: string }>(
    `SELECT id FROM vendor_contracts WHERE tenant_id = ? AND vendor_id = ? AND reference = ?`,

    guarded.tenantId,

    vendor.id,

    reference,
  )

  if (clash) {
    throw badRequest(
      "A contract with that reference already exists for this vendor.",
      {
        reference: "Pick a different reference.",
      },
    )
  }

  const id = `vct_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  run(
    `INSERT INTO vendor_contracts (
        id, tenant_id, vendor_id, reference, title, value, currency,
        start_date, end_date, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    vendor.id,

    reference,

    title,

    amount,

    tenantCurrency(guarded.tenantId),

    startDate,

    endDate,

    notes,

    statusRaw,

    now(),
  )

  writeAudit(
    guarded,
    "vendor_contract.created",
    "vendor",
    vendor.id,
    { contractId: id },
    ctx.ip,
  )

  const row = get<ContractRow>(
    `SELECT * FROM vendor_contracts WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    id,
  )!

  return { contract: toContract(row) }
}

/** PATCH /api/vendors/:id/contracts/:contractId */

export async function updateVendorContract(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "edit")

  const row = get<ContractRow>(
    `SELECT * FROM vendor_contracts
      WHERE tenant_id = ? AND vendor_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,

    ctx.params.contractId!,
  )

  if (!row) throw notFound("That contract does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const title = typeof body.title === "string" ? body.title.trim() : row.title

  if (title === "") errors.title = "Give the contract a title."

  const statusRaw = typeof body.status === "string" ? body.status : row.status

  if (!isVendorContractStatus(statusRaw))
    errors.status = "Unknown contract status."

  const notes = bounded(body.notes, VENDOR_CONTRACT_NOTES_MAX, "notes", errors)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  run(
    `UPDATE vendor_contracts SET title = ?, notes = ?, status = ?
      WHERE tenant_id = ? AND id = ?`,

    title,

    notes,

    statusRaw,

    guarded.tenantId,

    row.id,
  )

  writeAudit(
    guarded,
    "vendor_contract.updated",
    "vendor",
    row.vendor_id,
    { contractId: row.id },
    ctx.ip,
  )

  const updated = get<ContractRow>(
    `SELECT * FROM vendor_contracts WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    row.id,
  )!

  return { contract: toContract(updated) }
}

function optionalDate(
  value: unknown,

  field: string,

  errors: Record<string, string>,
): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()

  if (trimmed === "") return null

  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(trimmed)) {
    errors[field] = "Use a YYYY-MM-DD date."

    return null
  }

  return trimmed.includes("T") ? trimmed : `${trimmed}T00:00:00.000Z`
}

// --- Invoices --------------------------------------------------------------

interface InvoiceRow {
  id: string

  tenant_id: string

  vendor_id: string

  contract_id: string | null

  reference: string

  amount: number

  currency: string

  issued_at: string

  due_at: string | null

  status: string

  paid_at: string | null

  note: string | null

  created_at: string
}

function toInvoice(row: InvoiceRow): VendorInvoice {
  return {
    id: row.id,

    vendorId: row.vendor_id,

    contractId: row.contract_id,

    reference: row.reference,

    amount: row.amount,

    currency: row.currency,

    issuedAt: row.issued_at,

    dueAt: row.due_at,

    status: row.status as VendorInvoiceStatus,

    paidAt: row.paid_at,

    note: row.note,
  }
}

/** GET /api/vendors/:id/invoices */

export async function listVendorInvoices(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "view")

  const vendor = get<{ id: string }>(
    `SELECT id FROM vendors WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!vendor) throw notFound("That vendor does not exist")

  const status = ctx.query.get("status") ?? ""

  const clauses = ["tenant_id = ?", "vendor_id = ?"]

  const params: Array<string | number> = [guarded.tenantId, vendor.id]

  if (status && isVendorInvoiceStatus(status)) {
    clauses.push("status = ?")

    params.push(status)
  }

  const rows = all<InvoiceRow>(
    `SELECT * FROM vendor_invoices WHERE ${clauses.join(" AND ")}
      ORDER BY issued_at DESC, rowid DESC`,

    ...params,
  )

  return {
    invoices: rows.map(toInvoice),
    canEdit: guarded.can("vendors", "edit"),
  }
}

/**
 * POST /api/vendors/:id/invoices — raise a payable against a vendor.
 *
 * Creates the invoice row and appends a positive `invoice` row to the vendor
 * ledger inside one transaction, so a half-recorded payable never leaves the
 * ledger and the invoice table disagreeing.
 */

export async function createVendorInvoice(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "edit")

  const vendor = get<{ id: string }>(
    `SELECT id FROM vendors WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!vendor) throw notFound("That vendor does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const reference =
    typeof body.reference === "string" ? body.reference.trim() : ""

  if (reference === "") errors.reference = "Give the invoice a reference."
  else if (reference.length > VENDOR_INVOICE_REFERENCE_MAX) {
    errors.reference = `Use ${VENDOR_INVOICE_REFERENCE_MAX} characters or fewer.`
  }

  const amount =
    typeof body.amount === "number" &&
    Number.isSafeInteger(body.amount) &&
    body.amount > 0 &&
    body.amount <= VENDOR_INVOICE_AMOUNT_MAX
      ? body.amount
      : null

  if (amount === null) {
    errors.amount = `Enter a whole number from 1 to ${VENDOR_INVOICE_AMOUNT_MAX}.`
  }

  const issuedAtRaw =
    typeof body.issuedAt === "string" ? body.issuedAt.trim() : ""

  const issuedAt = optionalDate(body.issuedAt, "issuedAt", errors)

  if (issuedAt === null && issuedAtRaw === "")
    errors.issuedAt = "Enter the issue date."

  const dueAt = optionalDate(body.dueAt, "dueAt", errors)

  const contractId =
    typeof body.contractId === "string" && body.contractId.trim() !== ""
      ? body.contractId.trim()
      : null

  if (contractId) {
    const hit = get<{ id: string }>(
      `SELECT id FROM vendor_contracts WHERE tenant_id = ? AND vendor_id = ? AND id = ?`,

      guarded.tenantId,

      vendor.id,

      contractId,
    )

    if (!hit)
      errors.contractId = "That contract does not belong to this vendor."
  }

  const note = bounded(body.note, VENDOR_LEDGER_NOTE_MAX, "note", errors)

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const clash = get<{ id: string }>(
    `SELECT id FROM vendor_invoices WHERE tenant_id = ? AND vendor_id = ? AND reference = ?`,

    guarded.tenantId,

    vendor.id,

    reference,
  )

  if (clash) {
    throw badRequest(
      "An invoice with that reference already exists for this vendor.",
      {
        reference: "Pick a different reference.",
      },
    )
  }

  const id = `vin_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  transaction(() => {
    run(
      `INSERT INTO vendor_invoices (
          id, tenant_id, vendor_id, contract_id, reference, amount, currency,
          issued_at, due_at, status, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,

      id,

      guarded.tenantId,

      vendor.id,

      contractId,

      reference,

      amount,

      tenantCurrency(guarded.tenantId),

      issuedAt,

      dueAt,

      note,

      stamp,
    )

    appendVendorLedger(guarded.tenantId, {
      vendorId: vendor.id,

      kind: "invoice",

      amount: amount as number,

      currency: tenantCurrency(guarded.tenantId),

      reference,

      invoiceId: id,

      contractId,

      sourceType: "vendor_invoice",

      sourceId: id,

      occurredAt: issuedAt ?? stamp,

      note,

      recordedByUserId: guarded.userId,

      recordedByName: guarded.session.user.fullName,
    })
  })

  writeAudit(
    guarded,
    "vendor_invoice.created",
    "vendor",
    vendor.id,
    { invoiceId: id, amount },
    ctx.ip,
  )

  const row = get<InvoiceRow>(
    `SELECT * FROM vendor_invoices WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    id,
  )!

  return { invoice: toInvoice(row) }
}

/** POST /api/vendors/:id/invoices/:invoiceId/void — write an opposite adjustment. */

export async function voidVendorInvoice(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "edit")

  const invoice = get<InvoiceRow>(
    `SELECT * FROM vendor_invoices
      WHERE tenant_id = ? AND vendor_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,

    ctx.params.invoiceId!,
  )

  if (!invoice) throw notFound("That invoice does not exist")

  if (invoice.status === "void") {
    return { invoice: toInvoice(invoice) }
  }

  if (invoice.status === "paid") {
    throw badRequest(
      "A paid invoice cannot be voided. Record a refund adjustment instead.",
      {
        status: "This invoice is already paid.",
      },
    )
  }

  const stamp = now()

  transaction(() => {
    run(
      `UPDATE vendor_invoices SET status = 'void' WHERE tenant_id = ? AND id = ?`,

      guarded.tenantId,

      invoice.id,
    )

    appendVendorLedger(guarded.tenantId, {
      vendorId: invoice.vendor_id,

      kind: "adjustment",

      // Equal and opposite of the original `invoice` row so the balance undoes.

      amount: -invoice.amount,

      currency: invoice.currency,

      reference: invoice.reference,

      invoiceId: invoice.id,

      contractId: invoice.contract_id,

      sourceType: "vendor_invoice_void",

      sourceId: invoice.id,

      occurredAt: stamp,

      note: `Void of invoice ${invoice.reference}`,

      recordedByUserId: guarded.userId,

      recordedByName: guarded.session.user.fullName,
    })
  })

  writeAudit(
    guarded,
    "vendor_invoice.voided",
    "vendor",
    invoice.vendor_id,
    { invoiceId: invoice.id },
    ctx.ip,
  )

  const row = get<InvoiceRow>(
    `SELECT * FROM vendor_invoices WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    invoice.id,
  )!

  return { invoice: toInvoice(row) }
}

// --- Payments --------------------------------------------------------------

/**
 * POST /api/vendors/:id/payments — pay an invoice (or record a signed adjustment).
 *
 * A payment against an open invoice lands a negative `payment` row on the ledger
 * and flips the invoice to `paid` when the total paid meets the invoice amount;
 * partials are cumulative so a second call with the remainder closes the invoice.
 * An adjustment (`invoiceId` omitted) writes a signed `adjustment` row instead.
 */

export async function recordVendorPayment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "edit")

  const vendor = get<{ id: string }>(
    `SELECT id FROM vendors WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!vendor) throw notFound("That vendor does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const amount =
    typeof body.amount === "number" &&
    Number.isSafeInteger(body.amount) &&
    body.amount !== 0 &&
    Math.abs(body.amount) <= VENDOR_INVOICE_AMOUNT_MAX
      ? body.amount
      : null

  const invoiceId =
    typeof body.invoiceId === "string" && body.invoiceId.trim() !== ""
      ? body.invoiceId.trim()
      : null

  const note = bounded(body.note, VENDOR_LEDGER_NOTE_MAX, "note", errors)

  const occurredAt =
    optionalDate(body.occurredAt, "occurredAt", errors) ?? now()

  let invoice: InvoiceRow | null = null

  if (invoiceId) {
    invoice =
      get<InvoiceRow>(
        `SELECT * FROM vendor_invoices WHERE tenant_id = ? AND vendor_id = ? AND id = ?`,

        guarded.tenantId,

        vendor.id,

        invoiceId,
      ) ?? null

    if (!invoice)
      errors.invoiceId = "That invoice does not belong to this vendor."
    else if (invoice.status === "void") {
      errors.invoiceId = "A voided invoice cannot be paid."
    }
  }

  if (amount === null) {
    errors.amount = `Enter a whole number between 1 and ${VENDOR_INVOICE_AMOUNT_MAX} (or a signed value for an adjustment).`
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const stamp = now()

  const ledgerKind: VendorLedgerKind = invoice ? "payment" : "adjustment"

  // A payment against an invoice is stored negative (money out); an adjustment

  // keeps the caller's signed value so it can either add to or reduce the payable.

  const payableAmount = amount as number

  const ledgerAmount = invoice ? -payableAmount : payableAmount

  transaction(() => {
    const ledgerId = appendVendorLedger(guarded.tenantId, {
      vendorId: vendor.id,

      kind: ledgerKind,

      amount: ledgerAmount,

      currency: tenantCurrency(guarded.tenantId),

      reference: invoice?.reference ?? null,

      invoiceId: invoice?.id ?? null,

      contractId: invoice?.contract_id ?? null,

      sourceType: invoice ? "vendor_payment" : "vendor_adjustment",

      sourceId: invoice?.id ?? null,

      occurredAt,

      note,

      recordedByUserId: guarded.userId,

      recordedByName: guarded.session.user.fullName,
    })

    if (invoice) {
      const paid =
        get<{ n: number }>(
          `SELECT COALESCE(SUM(-amount), 0) AS n FROM vendor_ledger_entries
          WHERE tenant_id = ? AND invoice_id = ? AND kind = 'payment'`,

          guarded.tenantId,

          invoice.id,
        )?.n ?? 0

      if (paid >= invoice.amount) {
        run(
          `UPDATE vendor_invoices SET status = 'paid', paid_at = ?
            WHERE tenant_id = ? AND id = ?`,

          stamp,

          guarded.tenantId,

          invoice.id,
        )
      }
    }

    return ledgerId
  })

  writeAudit(
    guarded,

    invoice ? "vendor_payment.recorded" : "vendor_adjustment.recorded",

    "vendor",

    vendor.id,

    { amount: ledgerAmount, invoiceId: invoice?.id ?? null },

    ctx.ip,
  )

  return { ok: true, vendorId: vendor.id }
}

// --- Ledger ----------------------------------------------------------------

interface LedgerRow {
  id: string

  kind: string

  amount: number

  currency: string

  reference: string | null

  invoice_id: string | null

  contract_id: string | null

  expense_id: string | null

  source_type: string | null

  source_id: string | null

  occurred_at: string

  note: string | null

  recorded_by_name: string
}

interface LedgerJoinedRow extends LedgerRow {
  invoice_reference: string | null
}

/**
 * GET /api/vendors/:id/ledger — every event on the vendor's account, oldest
 * first, with the running balance folded in.
 */

export async function listVendorLedger(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "vendors", "view")

  const vendor = get<{ id: string }>(
    `SELECT id FROM vendors WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!vendor) throw notFound("That vendor does not exist")

  const rows = all<LedgerJoinedRow>(
    `SELECT l.*, i.reference AS invoice_reference
       FROM vendor_ledger_entries l
       LEFT JOIN vendor_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.vendor_id = ?
      ORDER BY l.occurred_at ASC, l.rowid ASC`,

    guarded.tenantId,

    vendor.id,
  )

  let balance = 0

  const entries: VendorLedgerEntry[] = rows.map((row) => {
    balance += row.amount

    return {
      id: row.id,

      kind: row.kind as VendorLedgerKind,

      amount: row.amount,

      currency: row.currency,

      reference: row.reference,

      invoiceId: row.invoice_id,

      invoiceReference: row.invoice_reference,

      contractId: row.contract_id,

      expenseId: row.expense_id,

      sourceType: row.source_type,

      sourceId: row.source_id,

      occurredAt: row.occurred_at,

      note: row.note,

      recordedByName: row.recorded_by_name,

      balanceAfter: balance,
    }
  })

  return {
    entries,

    currency: tenantCurrency(guarded.tenantId),

    balance,
  }
}

/**
 * The internal helper that appends a vendor-ledger row inside the caller's open
 * transaction. Kept here rather than in a separate module so the ledger table
 * has exactly one owner and its shape stays in one place.
 */

/**
 * Appends one signed row to a vendor's payable ledger. Exported because the
 * procurement GRN flow raises ordinary vendor invoices — the payable trail
 * has exactly one writer, and it is this function.
 */

export interface VendorLedgerAppendInput {
  vendorId: string

  kind: VendorLedgerKind

  amount: number

  currency: string

  reference: string | null

  invoiceId: string | null

  contractId: string | null

  sourceType: string | null

  sourceId: string | null

  occurredAt: string

  note: string | null

  recordedByUserId: string

  recordedByName: string
}

export function appendVendorLedger(
  tenantId: string,

  input: VendorLedgerAppendInput,
): string {
  if (!isVendorLedgerKind(input.kind)) {
    throw badRequest("Unknown vendor ledger kind.")
  }

  const id = `vled_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO vendor_ledger_entries (
        id, tenant_id, vendor_id, invoice_id, expense_id, contract_id, kind, amount,
        currency, reference, source_type, source_id, occurred_at, note,
        recorded_by_user_id, recorded_by_name, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    tenantId,

    input.vendorId,

    input.invoiceId,

    input.contractId,

    input.kind,

    input.amount,

    input.currency,

    input.reference,

    input.sourceType,

    input.sourceId,

    input.occurredAt,

    input.note,

    input.recordedByUserId,

    input.recordedByName,

    stamp,
  )

  return id
}

/** The `apply` path for an expense paid against a vendor's invoice (kept exported for tests). */

export function _internalAppendVendorLedgerForExpense(
  tenantId: string,

  vendorId: string,

  expenseId: string,

  amount: number,

  currency: string,

  description: string,

  actorUserId: string,

  actorName: string,
): string {
  return appendVendorLedger(tenantId, {
    vendorId,

    kind: "payment",

    amount: -amount,

    currency,

    reference: expenseId,

    invoiceId: null,

    contractId: null,

    sourceType: "expense",

    sourceId: expenseId,

    occurredAt: now(),

    note: description,

    recordedByUserId: actorUserId,

    recordedByName: actorName,
  })
}
