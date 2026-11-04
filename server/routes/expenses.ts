/**
 * The expenses module: raise a spend, attach a receipt, route payment through the
 * maker-checker queue, and settle it once a different user signs off.
 *
 * An expense is never silently deleted; it moves draft -> pending_approval ->
 * approved -> paid, or is rejected once approval lands on the "no" side. On
 * approval the row is flipped to `approved`; on rejection back to `rejected`. The
 * finance desk then marks it `paid` explicitly — this keeps the two decisions
 * (sign-off vs. cash out) visible and auditable rather than fused.
 *
 * When a paid expense carries a vendor, a matching negative row lands on that
 * vendor's ledger (kind `payment`) so the running balance is honest. The
 * attachment endpoint mirrors the tenant-logo pattern: a base64 data URL posted as
 * JSON with a route-specific body cap, mime validated against the closed allow
 * list, and a per-expense count cap enforced before the insert.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  notFound,
  readJsonBody,
  sendJson,
  type RequestContext,
} from "../http.ts"

import {
  requireAuth,
  requirePermission,
  writeAudit,
  type GuardedContext,
} from "../middleware.ts"

import {
  EXPENSE_AMOUNT_MAX,
  EXPENSE_ATTACHMENT_ALLOWED_MIMES,
  EXPENSE_ATTACHMENT_FILENAME_MAX,
  EXPENSE_ATTACHMENT_MAX_BYTES,
  EXPENSE_ATTACHMENT_MAX_COUNT,
  EXPENSE_CATEGORIES,
  EXPENSE_DESCRIPTION_MAX,
  isExpenseCategory,
  type Expense,
  type ExpenseAttachmentMeta,
  type ExpenseCategory,
} from "../../shared/expenses.ts"

import type { ExpenseApprovalPayload } from "../../shared/approvals.ts"

import { insertApproval, pendingApprovalFor } from "./approvals.ts"

const now = () => new Date().toISOString()

/** Body cap for the attachment endpoint: a base64 5 MB blob plus envelope. */

const ATTACHMENT_MAX_REQUEST_BYTES =
  Math.ceil(EXPENSE_ATTACHMENT_MAX_BYTES * 1.4) + 64 * 1024

function tenantCurrency(tenantId: string): string {
  return (
    get<{ currency: string }>(
      "SELECT currency FROM tenants WHERE id = ?",

      tenantId,
    )?.currency ?? "AED"
  )
}

interface ExpenseRow {
  id: string

  tenant_id: string

  category: string

  project_id: string | null

  vendor_id: string | null

  description: string

  amount: number

  currency: string

  occurred_at: string

  status: string

  approval_id: string | null

  paid_at: string | null

  created_by_user_id: string

  created_by_name: string

  created_at: string

  updated_at: string
}

interface ExpenseJoinRow extends ExpenseRow {
  project_code: string | null

  project_name: string | null

  vendor_name: string | null

  attachment_count: number
}

function toExpense(
  row: ExpenseJoinRow,
  can: (action: "create" | "edit" | "approve") => boolean,
): Expense {
  const status = row.status

  return {
    id: row.id,

    category: row.category as ExpenseCategory,

    projectId: row.project_id,

    projectCode: row.project_code,

    projectName: row.project_name,

    vendorId: row.vendor_id,

    vendorName: row.vendor_name,

    description: row.description,

    amount: row.amount,

    currency: row.currency,

    occurredAt: row.occurred_at,

    status: status as Expense["status"],

    approvalId: row.approval_id,

    paidAt: row.paid_at,

    createdByUserId: row.created_by_user_id,

    createdByName: row.created_by_name,

    createdAt: row.created_at,

    updatedAt: row.updated_at,

    attachmentCount: row.attachment_count,

    canSubmit: can("edit") && (status === "draft" || status === "rejected"),

    canMarkPaid: can("edit") && status === "approved",
  }
}

const SELECT_WITH_JOINS = `
  SELECT e.*,
         p.code AS project_code,
         p.name AS project_name,
         v.name AS vendor_name,
         (SELECT COUNT(*) FROM expense_attachments a
            WHERE a.tenant_id = e.tenant_id AND a.expense_id = e.id) AS attachment_count
    FROM expenses e
    LEFT JOIN projects p ON p.id = e.project_id AND p.tenant_id = e.tenant_id
    LEFT JOIN vendors  v ON v.id = e.vendor_id  AND v.tenant_id = e.tenant_id
`

function loadExpenseJoin(
  tenantId: string,
  id: string,
): ExpenseJoinRow | undefined {
  return get<ExpenseJoinRow>(
    `${SELECT_WITH_JOINS} WHERE e.tenant_id = ? AND e.id = ?`,

    tenantId,

    id,
  )
}

/**
 * Validate a create/patch body. Returns the fields ready for the insert/update or
 * raises a field-keyed 400. Vendor and project ids are checked for existence in
 * the same query the caller already scoped to the tenant, so a foreign id reads
 * as "no such project/vendor" rather than "unauthorised".
 */

interface ValidatedExpenseInput {
  category: ExpenseCategory

  projectId: string | null

  vendorId: string | null

  description: string

  amount: number

  occurredAt: string
}

function validateExpenseBody(
  tenantId: string,

  body: Record<string, unknown>,
): ValidatedExpenseInput {
  const errors: Record<string, string> = {}

  const category = typeof body.category === "string" ? body.category : ""

  if (!isExpenseCategory(category)) {
    errors.category = "Pick a valid expense category."
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : ""

  if (description === "")
    errors.description = "Describe what this spend is for."
  else if (description.length > EXPENSE_DESCRIPTION_MAX) {
    errors.description = `Use ${EXPENSE_DESCRIPTION_MAX} characters or fewer.`
  }

  const amount =
    typeof body.amount === "number" &&
    Number.isSafeInteger(body.amount) &&
    body.amount > 0 &&
    body.amount <= EXPENSE_AMOUNT_MAX
      ? body.amount
      : null

  if (amount === null) {
    errors.amount = `Enter a whole number from 1 to ${EXPENSE_AMOUNT_MAX}.`
  }

  const occurredAtRaw =
    typeof body.occurredAt === "string" ? body.occurredAt.trim() : ""

  const occurredAt = normaliseDate(occurredAtRaw)

  if (!occurredAt) errors.occurredAt = "Enter the date the spend occurred."

  const projectId =
    typeof body.projectId === "string" && body.projectId.trim() !== ""
      ? body.projectId.trim()
      : null

  if (projectId) {
    const hit = get<{ id: string }>(
      `SELECT id FROM projects WHERE tenant_id = ? AND id = ?`,

      tenantId,

      projectId,
    )

    if (!hit) errors.projectId = "That project does not exist."
  }

  const vendorId =
    typeof body.vendorId === "string" && body.vendorId.trim() !== ""
      ? body.vendorId.trim()
      : null

  if (vendorId) {
    const hit = get<{ id: string }>(
      `SELECT id FROM vendors WHERE tenant_id = ? AND id = ?`,

      tenantId,

      vendorId,
    )

    if (!hit) errors.vendorId = "That vendor does not exist."
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  return {
    category: category as ExpenseCategory,

    projectId,

    vendorId,

    description,

    amount: amount as number,

    occurredAt: occurredAt as string,
  }
}

/** Accepts either a plain `YYYY-MM-DD` or a full ISO timestamp, and returns an ISO instant. */

function normaliseDate(value: string): string | null {
  if (!value) return null

  const matched = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(value)

  if (!matched) return null

  const stamp = new Date(
    value.includes("T") || value.includes(" ")
      ? value
      : `${value}T00:00:00.000Z`,
  )

  if (Number.isNaN(stamp.getTime())) return null

  return stamp.toISOString()
}

/** GET /api/expenses — the tenant's spend list, filtered. */

export async function listExpenses(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "view")

  const category = ctx.query.get("category") ?? ""

  const status = ctx.query.get("status") ?? ""

  const projectId = ctx.query.get("project") ?? ""

  const vendorId = ctx.query.get("vendor") ?? ""

  const from = ctx.query.get("from") ?? ""

  const to = ctx.query.get("to") ?? ""

  const clauses: string[] = ["e.tenant_id = ?"]

  const params: Array<string | number> = [guarded.tenantId]

  if (category && EXPENSE_CATEGORIES.includes(category as ExpenseCategory)) {
    clauses.push("e.category = ?")

    params.push(category)
  }

  if (
    status &&
    ["draft", "pending_approval", "approved", "paid", "rejected"].includes(
      status,
    )
  ) {
    clauses.push("e.status = ?")

    params.push(status)
  }

  if (projectId) {
    clauses.push("e.project_id = ?")

    params.push(projectId)
  }

  if (vendorId) {
    clauses.push("e.vendor_id = ?")

    params.push(vendorId)
  }

  if (from) {
    clauses.push("e.occurred_at >= ?")

    params.push(from)
  }

  if (to) {
    clauses.push("e.occurred_at <= ?")

    // Widen a bare date to end-of-day so `to` behaves like an inclusive filter.

    const value = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to

    params[params.length - 1] = value
  }

  const rows = all<ExpenseJoinRow>(
    `${SELECT_WITH_JOINS}
      WHERE ${clauses.join(" AND ")}
      ORDER BY e.occurred_at DESC, e.rowid DESC`,

    ...params,
  )

  const can = (action: "create" | "edit" | "approve") =>
    guarded.can("expenses", action)

  return {
    expenses: rows.map((row) => toExpense(row, can)),

    currency: tenantCurrency(guarded.tenantId),

    canCreate: can("create"),

    canEdit: can("edit"),

    canApprove: can("approve"),
  }
}

/** POST /api/expenses — create a draft. Money does not move until approval + mark-paid. */

export async function createExpense(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const input = validateExpenseBody(guarded.tenantId, body)

  const id = `exp_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO expenses (
        id, tenant_id, category, project_id, vendor_id, description, amount, currency,
        occurred_at, status, created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    input.category,

    input.projectId,

    input.vendorId,

    input.description,

    input.amount,

    tenantCurrency(guarded.tenantId),

    input.occurredAt,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    stamp,
  )

  writeAudit(
    guarded,
    "expense.created",
    "expense",
    id,
    { amount: input.amount },
    ctx.ip,
  )

  const row = loadExpenseJoin(guarded.tenantId, id)!

  return {
    expense: toExpense(row, (action) => guarded.can("expenses", action)),
  }
}

/** GET /api/expenses/:id */

export async function getExpense(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "view")

  const row = loadExpenseJoin(guarded.tenantId, ctx.params.id!)

  if (!row) throw notFound("That expense does not exist")

  const attachments = all<AttachmentRow>(
    `SELECT id, expense_id, filename, mime, size_bytes, uploaded_by_name, uploaded_at
       FROM expense_attachments
      WHERE tenant_id = ? AND expense_id = ?
      ORDER BY uploaded_at ASC, rowid ASC`,

    guarded.tenantId,

    row.id,
  )

  return {
    expense: toExpense(row, (action) => guarded.can("expenses", action)),

    attachments: attachments.map(toAttachmentMeta),
  }
}

/** PATCH /api/expenses/:id — allowed only on a draft or a rejected row. */

export async function updateExpense(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "edit")

  const existing = get<ExpenseRow>(
    `SELECT * FROM expenses WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!existing) throw notFound("That expense does not exist")

  if (existing.status !== "draft" && existing.status !== "rejected") {
    throw badRequest("Only a draft or a rejected expense can be edited.", {
      status: "A submitted or paid expense is read-only.",
    })
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const input = validateExpenseBody(guarded.tenantId, body)

  run(
    `UPDATE expenses
        SET category = ?, project_id = ?, vendor_id = ?, description = ?,
            amount = ?, occurred_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    input.category,

    input.projectId,

    input.vendorId,

    input.description,

    input.amount,

    input.occurredAt,

    now(),

    guarded.tenantId,

    existing.id,
  )

  // A rejected row edited back into a draft: the old rejection is no longer

  // relevant, but the audit trail keeps the previous approval id for reference.

  if (existing.status === "rejected") {
    run(
      `UPDATE expenses SET status = 'draft', approval_id = NULL, updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      now(),

      guarded.tenantId,

      existing.id,
    )
  }

  writeAudit(guarded, "expense.updated", "expense", existing.id, null, ctx.ip)

  const row = loadExpenseJoin(guarded.tenantId, existing.id)!

  return {
    expense: toExpense(row, (action) => guarded.can("expenses", action)),
  }
}

/**
 * POST /api/expenses/:id/submit — open the maker-checker approval.
 *
 * A duplicate submit on an expense that already has a pending approval returns
 * the existing approval rather than stacking another. The expense flips from
 * draft (or rejected) to pending_approval inside the same transaction.
 */

export async function submitExpense(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "edit")

  const existing = get<ExpenseRow>(
    `SELECT * FROM expenses WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!existing) throw notFound("That expense does not exist")

  if (existing.status !== "draft" && existing.status !== "rejected") {
    throw badRequest("Only a draft or a rejected expense can be submitted.", {
      status: "This expense is already in flight.",
    })
  }

  const result = transaction(() => {
    const held = pendingApprovalFor(guarded.tenantId, "expense", existing.id)

    const payload: ExpenseApprovalPayload = {
      expenseId: existing.id,

      category: existing.category as ExpenseCategory,

      vendorName: existing.vendor_id
        ? (get<{ name: string }>(
            `SELECT name FROM vendors WHERE tenant_id = ? AND id = ?`,

            guarded.tenantId,

            existing.vendor_id,
          )?.name ?? null)
        : null,

      projectName: existing.project_id
        ? (get<{ name: string }>(
            `SELECT name FROM projects WHERE tenant_id = ? AND id = ?`,

            guarded.tenantId,

            existing.project_id,
          )?.name ?? null)
        : null,

      amount: existing.amount,

      currency: existing.currency,

      description: existing.description,

      occurredAt: existing.occurred_at,
    }

    const summary = `Expense payment: ${existing.description.slice(0, 80)}`

    const approval = held
      ? { id: held.id }
      : insertApproval({
          tenantId: guarded.tenantId,

          actionKey: "expense",

          summary,

          payload,

          entityType: "expense",

          resultEntityId: existing.id,

          requestedByUserId: guarded.userId,

          requestedByName: guarded.session.user.fullName,
        })

    run(
      `UPDATE expenses
          SET status = 'pending_approval', approval_id = ?, updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      approval.id,

      now(),

      guarded.tenantId,

      existing.id,
    )

    return approval.id
  })

  writeAudit(
    guarded,

    "expense.submitted",

    "expense",

    existing.id,

    { approvalId: result },

    ctx.ip,
  )

  const row = loadExpenseJoin(guarded.tenantId, existing.id)!

  return {
    expense: toExpense(row, (action) => guarded.can("expenses", action)),

    approvalId: result,

    pending: true,
  }
}

/**
 * POST /api/expenses/:id/mark-paid — settle an approved expense.
 *
 * Only a row currently in `approved` may be marked paid. When the expense carries
 * a vendor, a matching negative `payment` row lands on that vendor's ledger so
 * the payable balance is honest.
 */

export async function markExpensePaid(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "edit")

  const existing = get<ExpenseRow>(
    `SELECT * FROM expenses WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!existing) throw notFound("That expense does not exist")

  if (existing.status === "paid") {
    const row = loadExpenseJoin(guarded.tenantId, existing.id)!

    return {
      expense: toExpense(row, (action) => guarded.can("expenses", action)),
    }
  }

  if (existing.status !== "approved") {
    throw badRequest("Only an approved expense can be marked paid.", {
      status: "Ask a colleague to sign this off first.",
    })
  }

  transaction(() => {
    run(
      `UPDATE expenses SET status = 'paid', paid_at = ?, updated_at = ?
        WHERE tenant_id = ? AND id = ?`,

      now(),

      now(),

      guarded.tenantId,

      existing.id,
    )

    if (existing.vendor_id) {
      appendVendorLedgerPayment(guarded, existing)
    }
  })

  writeAudit(
    guarded,
    "expense.marked_paid",
    "expense",
    existing.id,
    null,
    ctx.ip,
  )

  const row = loadExpenseJoin(guarded.tenantId, existing.id)!

  return {
    expense: toExpense(row, (action) => guarded.can("expenses", action)),
  }
}

/** The insert into the vendor ledger that a paid expense triggers. Kept here so
 *  the ledger table itself stays owned by `routes/vendors.ts`. */

function appendVendorLedgerPayment(
  guarded: GuardedContext,
  expense: ExpenseRow,
) {
  const id = `vled_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO vendor_ledger_entries (
        id, tenant_id, vendor_id, invoice_id, expense_id, contract_id, kind, amount,
        currency, reference, source_type, source_id, occurred_at, note,
        recorded_by_user_id, recorded_by_name, created_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, 'payment', ?, ?, ?, 'expense', ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    expense.vendor_id,

    expense.id,

    // Paid expense reduces what we owe the vendor.

    -expense.amount,

    expense.currency,

    expense.id,

    expense.id,

    stamp,

    expense.description,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,
  )
}

// --- Attachments -----------------------------------------------------------

interface AttachmentRow {
  id: string

  expense_id: string

  filename: string

  mime: string

  size_bytes: number

  uploaded_by_name: string

  uploaded_at: string

  data?: string
}

/** The JSON body the attachment upload endpoint accepts. */
interface AttachmentUploadBody {
  filename?: unknown
  dataUrl?: unknown
}

/** The columns streamed back when a stored attachment is fetched. */
interface AttachmentDataRow {
  filename: string
  mime: string
  data: string
}

function toAttachmentMeta(row: AttachmentRow): ExpenseAttachmentMeta {
  return {
    id: row.id,

    expenseId: row.expense_id,

    filename: row.filename,

    mime: row.mime,

    sizeBytes: row.size_bytes,

    uploadedByName: row.uploaded_by_name,

    uploadedAt: row.uploaded_at,
  }
}

/**
 * Parse a `data:mime;base64,...` string, honouring the closed mime allow list and
 * the 5 MB per-file byte cap. Returns the pieces the row needs, or an error the
 * caller turns into a field-keyed 400.
 */

interface ParsedDataUrlOk {
  ok: true
  mime: string
  dataUrl: string
  bytes: number
}

interface ParsedDataUrlError {
  ok: false
  error: string
}

function parseDataUrl(value: unknown): ParsedDataUrlOk | ParsedDataUrlError {
  if (typeof value !== "string")
    return { ok: false, error: "Attachment data is required." }

  const matched = /^data:([a-z0-9/\-.+]+);base64,(.+)$/i.exec(value)

  if (!matched)
    return { ok: false, error: "Attachment must be a base64 data URL." }

  const mime = matched[1]!.toLowerCase()

  const base64 = matched[2]!

  if (!(EXPENSE_ATTACHMENT_ALLOWED_MIMES as readonly string[]).includes(mime)) {
    return {
      ok: false,

      error: `Allowed types: ${EXPENSE_ATTACHMENT_ALLOWED_MIMES.join(", ")}.`,
    }
  }

  let bytes: number

  try {
    bytes = Buffer.from(base64, "base64").length
  } catch {
    return { ok: false, error: "Attachment data is not valid base64." }
  }

  if (bytes > EXPENSE_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,

      error: `That file is too large. The limit is ${Math.floor(EXPENSE_ATTACHMENT_MAX_BYTES / 1024)} KB.`,
    }
  }

  if (bytes === 0) return { ok: false, error: "That file appears to be empty." }

  return { ok: true, mime, dataUrl: value, bytes }
}

/** POST /api/expenses/:id/attachments — accept a JSON `{ filename, dataUrl }`. */

export async function uploadExpenseAttachment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "edit")

  const expense = get<ExpenseRow>(
    `SELECT * FROM expenses WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!expense) throw notFound("That expense does not exist")

  if (expense.status === "paid") {
    throw badRequest("A paid expense cannot take new attachments.", {
      attachment: "This expense is closed.",
    })
  }

  const count =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM expense_attachments WHERE tenant_id = ? AND expense_id = ?`,

      guarded.tenantId,

      expense.id,
    )?.n ?? 0

  if (count >= EXPENSE_ATTACHMENT_MAX_COUNT) {
    throw badRequest("That expense already carries the maximum attachments.", {
      attachment: `A maximum of ${EXPENSE_ATTACHMENT_MAX_COUNT} files is allowed per expense.`,
    })
  }

  const body = await readJsonBody<AttachmentUploadBody>(
    ctx.req,

    ATTACHMENT_MAX_REQUEST_BYTES,
  )

  const parsed = parseDataUrl(body.dataUrl)

  if (!parsed.ok) throw badRequest(parsed.error, { dataUrl: parsed.error })

  const filename = typeof body.filename === "string" ? body.filename.trim() : ""

  if (filename === "") {
    throw badRequest("Give the attachment a filename.", {
      filename: "Required.",
    })
  }

  if (filename.length > EXPENSE_ATTACHMENT_FILENAME_MAX) {
    throw badRequest("That filename is too long.", {
      filename: `Use ${EXPENSE_ATTACHMENT_FILENAME_MAX} characters or fewer.`,
    })
  }

  const id = `att_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

  const stamp = now()

  run(
    `INSERT INTO expense_attachments (
        id, tenant_id, expense_id, filename, mime, size_bytes, data,
        uploaded_by_user_id, uploaded_by_name, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    expense.id,

    filename,

    parsed.mime,

    parsed.bytes,

    parsed.dataUrl,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,
  )

  writeAudit(
    guarded,

    "expense.attachment_uploaded",

    "expense",

    expense.id,

    { attachmentId: id, mime: parsed.mime, bytes: parsed.bytes },

    ctx.ip,
  )

  return { ok: true, attachmentId: id }
}

/**
 * GET /api/expenses/:id/attachments/:attachmentId
 *
 * Streams the base64 data URL back with its stored mime. Sends the raw bytes with
 * `Content-Disposition: inline` so a browser opens an image or a PDF in a tab and
 * falls back to a download when the caller asks for one via `?download=1`.
 */

export async function downloadExpenseAttachment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "view")

  const expense = get<{ id: string }>(
    `SELECT id FROM expenses WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!expense) throw notFound("That expense does not exist")

  const row = get<AttachmentDataRow>(
    `SELECT filename, mime, data FROM expense_attachments
      WHERE tenant_id = ? AND expense_id = ? AND id = ?`,

    guarded.tenantId,

    expense.id,

    ctx.params.attachmentId!,
  )

  if (!row) throw notFound("That attachment does not exist")

  // The stored value is a data URL; strip the prefix to write raw bytes.

  const commaIndex = row.data.indexOf(",")

  const base64 = commaIndex >= 0 ? row.data.slice(commaIndex + 1) : row.data

  const buffer = Buffer.from(base64, "base64")

  const disposition =
    ctx.query.get("download") === "1" ? "attachment" : "inline"

  const safeName = row.filename.replace(/["\r\n]/g, "")

  ctx.res.writeHead(200, {
    "Content-Type": row.mime,

    "Content-Length": buffer.byteLength,

    "Content-Disposition": `${disposition}; filename="${safeName}"`,

    "Cache-Control": "private, max-age=60",

    "X-Content-Type-Options": "nosniff",
  })

  ctx.res.end(buffer)
}

/** DELETE /api/expenses/:id/attachments/:attachmentId */

export async function deleteExpenseAttachment(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "expenses", "edit")

  const expense = get<ExpenseRow>(
    `SELECT * FROM expenses WHERE tenant_id = ? AND id = ?`,

    guarded.tenantId,

    ctx.params.id!,
  )

  if (!expense) throw notFound("That expense does not exist")

  if (expense.status === "paid") {
    throw badRequest("A paid expense cannot lose its attachments.", {
      attachment: "This expense is closed.",
    })
  }

  run(
    `DELETE FROM expense_attachments
      WHERE tenant_id = ? AND expense_id = ? AND id = ?`,

    guarded.tenantId,

    expense.id,

    ctx.params.attachmentId!,
  )

  writeAudit(
    guarded,

    "expense.attachment_deleted",

    "expense",

    expense.id,

    { attachmentId: ctx.params.attachmentId },

    ctx.ip,
  )

  sendJson(ctx.res, 200, { ok: true })
}

// --- Approval replay -------------------------------------------------------

/**
 * Sets an approved expense to `approved` so the finance desk can settle it. Called
 * from the approvals apply path with the caller's open transaction.
 */

export function applyExpense(tenantId: string, expenseId: string): string {
  const row = get<ExpenseRow>(
    `SELECT * FROM expenses WHERE tenant_id = ? AND id = ?`,

    tenantId,

    expenseId,
  )

  if (!row) throw notFound("That expense does not exist")

  if (row.status === "approved" || row.status === "paid") return row.id

  run(
    `UPDATE expenses SET status = 'approved', updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    now(),

    tenantId,

    expenseId,
  )

  return row.id
}

/** Sets a rejected expense to `rejected`. The row is preserved for the audit trail. */

export function rejectExpense(tenantId: string, expenseId: string): string {
  const row = get<ExpenseRow>(
    `SELECT * FROM expenses WHERE tenant_id = ? AND id = ?`,

    tenantId,

    expenseId,
  )

  if (!row) throw notFound("That expense does not exist")

  run(
    `UPDATE expenses SET status = 'rejected', updated_at = ?
      WHERE tenant_id = ? AND id = ? AND status IN ('draft', 'pending_approval')`,

    now(),

    tenantId,

    expenseId,
  )

  return row.id
}
