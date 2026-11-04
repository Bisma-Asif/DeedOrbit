/**
 * Documents & Signatures: templates, envelopes, and the public signing ceremony.
 *
 * A signature here is an *event*, not a certificate. It is recorded with the
 * name the signer typed, the instant, the IP, and a per-envelope token only the
 * recipient holds — the same hashing discipline the session cookie uses, so a
 * leaked row cannot be replayed. When every signer has signed, the rendered
 * agreement plus its signer chain is written back into the existing `documents`
 * table, so the workspace keeps one honest file trail.
 *
 * Two surfaces, one file:
 *   - the guarded workspace (module `signatures`): templates, envelopes, send, void;
 *   - the public ceremony (`/api/sign/:token`), which carries *no* session and is
 *     authorised by the hashed token alone. It never reveals other signers' tokens
 *     or the workspace's other records — only the rendered body and the recipient's
 *     own place in the chain.
 */

import { all, get, run, transaction } from "../db.ts"

import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  readJsonBody,
  type RequestContext,
} from "../http.ts"

import { requireAuth, requirePermission, writeAudit } from "../middleware.ts"

import { generateToken, hashToken } from "../crypto.ts"

import { notifyRecipients } from "../notify.ts"

import {
  ENVELOPE_MESSAGE_MAX,
  ENVELOPE_STATUS_LABELS,
  ENVELOPE_TITLE_MAX,
  ENVELOPE_TTL_DAYS_MAX,
  RECIPIENT_STATUS_LABELS,
  RECIPIENTS_MAX,
  RECIPIENTS_MIN,
  TEMPLATE_BODY_MAX,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_NAME_MAX,
  extractTokens,
  isRecipientRole,
  isTemplateCategory,
  type CeremonyActionResponse,
  type DocTemplateView,
  type EnvelopeListResponse,
  type EnvelopeMutationResponse,
  type EnvelopeRecipientView,
  type EnvelopeSendResponse,
  type EnvelopeStatus,
  type EnvelopeView,
  type RecipientStatus,
  type SigningCeremonyView,
  type TemplateListResponse,
} from "../../shared/signatures.ts"

const now = () => new Date().toISOString()

function idFor(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
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

/** An ISO timestamp `days` from now; `null` days yields no expiry. */

function daysFromNow(days: number | null): string | null {
  if (days === null) return null

  const date = new Date()

  date.setDate(date.getDate() + days)

  return date.toISOString()
}

function isLive(status: string, expiresAt: string | null): boolean {
  if (status !== "sent") return false

  if (!expiresAt) return true

  return new Date(expiresAt).getTime() > Date.now()
}

/**
 * The envelope's *effective* status: a stored `sent` row whose link has lapsed
 * reads as `expired`. Nothing flips the stored value — this is derived at read
 * time, so a lapsed link never misrepresents itself as open the next morning.
 */

function effectiveStatus(
  status: string,
  expiresAt: string | null,
): EnvelopeStatus {
  if (
    status === "sent" &&
    expiresAt &&
    new Date(expiresAt).getTime() <= Date.now()
  ) {
    return "expired"
  }

  return status as EnvelopeStatus
}

// --- Templates -------------------------------------------------------------

type TemplateRow = {
  id: string

  tenant_id: string

  name: string

  category: string

  body_text: string

  status: string

  created_by_user_id: string

  created_by_name: string

  created_at: string

  updated_at: string
}

function toTemplateView(row: TemplateRow): DocTemplateView {
  return {
    id: row.id,

    name: row.name,

    category: row.category,

    categoryLabel:
      TEMPLATE_CATEGORY_LABELS[
        ((isTemplateCategory(row.category)
          ? row.category
          : "other") as keyof typeof TEMPLATE_CATEGORY_LABELS)
      ],

    body: row.body_text,

    tokens: extractTokens(row.body_text),

    status: row.status,

    createdBy: row.created_by_name,

    createdAt: row.created_at,
  }
}

function loadTemplate(tenantId: string, id: string): TemplateRow | undefined {
  return get<TemplateRow>(
    "SELECT * FROM doc_templates WHERE tenant_id = ? AND id = ?",

    tenantId,

    id,
  )
}

/** GET /api/signatures/templates */

export async function listTemplates(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "view")

  const templates = allTemplates(guarded.tenantId).map(toTemplateView)

  return { templates } satisfies TemplateListResponse
}

function allTemplates(tenantId: string): TemplateRow[] {
  return all<TemplateRow>(
    `SELECT * FROM doc_templates WHERE tenant_id = ?
      ORDER BY status = 'active' DESC, name COLLATE NOCASE ASC`,

    tenantId,
  )
}

/** POST /api/signatures/templates */

export async function createTemplate(
  ctx: RequestContext,
): Promise<DocTemplateView> {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name === "") errors.name = "Give this template a name."
  else if (name.length > TEMPLATE_NAME_MAX)
    errors.name = `Use ${TEMPLATE_NAME_MAX} characters or fewer.`

  const category =
    typeof body.category === "string" && isTemplateCategory(body.category)
      ? body.category
      : "other"

  const bodyText = typeof body.body === "string" ? body.body : ""

  if (bodyText.trim() === "") errors.body = "The template needs some text."
  else if (bodyText.length > TEMPLATE_BODY_MAX)
    errors.body = `Use ${TEMPLATE_BODY_MAX} characters or fewer.`

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  const duplicate = get<{ id: string }>(
    "SELECT id FROM doc_templates WHERE tenant_id = ? AND name = ? COLLATE NOCASE",

    guarded.tenantId,

    name,
  )

  if (duplicate) {
    throw badRequest("A template with that name already exists.", {
      name: "Pick a different name or edit the existing template.",
    })
  }

  const id = idFor("dct")

  const stamp = now()

  run(
    `INSERT INTO doc_templates (
        id, tenant_id, name, category, body_text, status,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,

    id,

    guarded.tenantId,

    name,

    category,

    bodyText,

    guarded.userId,

    guarded.session.user.fullName,

    stamp,

    stamp,
  )

  writeAudit(
    guarded,

    "signature.template.create",

    "signature",

    id,

    { name, tokens: extractTokens(bodyText) },

    ctx.ip,
  )

  return toTemplateView(loadTemplate(guarded.tenantId, id)!)
}

/** PATCH /api/signatures/templates/:id — drafts and active text; status moves are separate. */

export async function updateTemplate(
  ctx: RequestContext,
): Promise<DocTemplateView> {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "edit")

  const existing = loadTemplate(guarded.tenantId, ctx.params.templateId!)

  if (!existing) throw notFound("That template does not exist")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const name =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim()
      : existing.name

  if (name.length > TEMPLATE_NAME_MAX)
    errors.name = `Use ${TEMPLATE_NAME_MAX} characters or fewer.`

  const category =
    typeof body.category === "string" && isTemplateCategory(body.category)
      ? body.category
      : existing.category

  const bodyText =
    typeof body.body === "string" && body.body.trim() !== ""
      ? body.body
      : existing.body_text

  if (bodyText.length > TEMPLATE_BODY_MAX)
    errors.body = `Use ${TEMPLATE_BODY_MAX} characters or fewer.`

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  if (name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = get<{ id: string }>(
      "SELECT id FROM doc_templates WHERE tenant_id = ? AND name = ? COLLATE NOCASE AND id <> ?",

      guarded.tenantId,

      name,

      existing.id,
    )

    if (duplicate) {
      throw badRequest("A template with that name already exists.", {
        name: "Pick a different name.",
      })
    }
  }

  run(
    `UPDATE doc_templates
        SET name = ?, category = ?, body_text = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    name,

    category,

    bodyText,

    now(),

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,

    "signature.template.update",

    "signature",

    existing.id,

    { name },

    ctx.ip,
  )

  return toTemplateView(loadTemplate(guarded.tenantId, existing.id)!)
}

/**
 * POST /api/signatures/templates/:id/release — a template that will go out
 * under the tenant's name is a decision, so release takes `approve`, not `edit`.
 */

export async function releaseTemplate(
  ctx: RequestContext,
): Promise<DocTemplateView> {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "approve")

  const existing = loadTemplate(guarded.tenantId, ctx.params.templateId!)

  if (!existing) throw notFound("That template does not exist")

  if (existing.status !== "draft") {
    throw conflict("Only a draft template can be released.")
  }

  run(
    `UPDATE doc_templates SET status = 'active', updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    now(),

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,
    "signature.template.release",
    "signature",
    existing.id,
    { name: existing.name },
    ctx.ip,
  )

  return toTemplateView(loadTemplate(guarded.tenantId, existing.id)!)
}

/** POST /api/signatures/templates/:id/archive — retired, never deleted (envelopes name it). */

export async function archiveTemplate(
  ctx: RequestContext,
): Promise<DocTemplateView> {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "edit")

  const existing = loadTemplate(guarded.tenantId, ctx.params.templateId!)

  if (!existing) throw notFound("That template does not exist")

  run(
    `UPDATE doc_templates SET status = 'archived', updated_at = ?
      WHERE tenant_id = ? AND id = ?`,

    now(),

    guarded.tenantId,

    existing.id,
  )

  writeAudit(
    guarded,
    "signature.template.archive",
    "signature",
    existing.id,
    { name: existing.name },
    ctx.ip,
  )

  return toTemplateView(loadTemplate(guarded.tenantId, existing.id)!)
}

// --- Envelopes -------------------------------------------------------------

type EnvelopeRow = {
  id: string

  tenant_id: string

  title: string

  message: string | null

  template_id: string | null

  document_id: string | null

  rendered_body: string

  project_id: string | null

  status: string

  token_hash: string | null

  sent_at: string | null

  expires_at: string | null

  completed_at: string | null

  void_reason: string | null

  completed_document_id: string | null

  created_by_user_id: string

  created_by_name: string

  created_at: string
}

type RecipientRow = {
  id: string

  tenant_id: string

  envelope_id: string

  name: string

  email: string

  role: string

  sign_order: number

  status: string

  signed_name: string | null

  signed_at: string | null

  signed_ip: string | null

  decline_reason: string | null

  opened_at: string | null

  created_at: string
}

function toRecipientView(row: RecipientRow): EnvelopeRecipientView {
  const status = (
    isRecipientStatusValue(row.status) ? row.status : "pending"
  ) as RecipientStatus

  return {
    id: row.id,

    name: row.name,

    email: row.email,

    role: row.role,

    signOrder: Number(row.sign_order),

    status,

    statusLabel: RECIPIENT_STATUS_LABELS[status],

    signedName: row.signed_name,

    signedAt: row.signed_at,
  }
}

function isRecipientStatusValue(value: string): boolean {
  return ["pending", "opened", "signed", "declined"].includes(value)
}

function recipientsOf(envelopeId: string): RecipientRow[] {
  return all<RecipientRow>(
    `SELECT * FROM envelope_recipients WHERE envelope_id = ?
      ORDER BY sign_order ASC, created_at ASC`,

    envelopeId,
  )
}

function templateName(
  tenantId: string,
  templateId: string | null,
): string | null {
  if (!templateId) return null

  return (
    get<{ name: string }>(
      "SELECT name FROM doc_templates WHERE tenant_id = ? AND id = ?",

      tenantId,

      templateId,
    )?.name ?? null
  )
}

function documentTitle(
  tenantId: string,
  documentId: string | null,
): string | null {
  if (!documentId) return null

  return (
    get<{ title: string }>(
      "SELECT title FROM documents WHERE tenant_id = ? AND id = ?",

      tenantId,

      documentId,
    )?.title ?? null
  )
}

function toEnvelopeView(row: EnvelopeRow): EnvelopeView {
  const status = effectiveStatus(row.status, row.expires_at)

  return {
    id: row.id,

    title: row.title,

    message: row.message,

    templateId: row.template_id,

    templateName: templateName(row.tenant_id, row.template_id),

    documentId: row.document_id,

    documentTitle: documentTitle(row.tenant_id, row.document_id),

    status,

    statusLabel: ENVELOPE_STATUS_LABELS[status],

    live: isLive(row.status, row.expires_at),

    sentAt: row.sent_at,

    expiresAt: row.expires_at,

    completedAt: row.completed_at,

    recipients: recipientsOf(row.id).map(toRecipientView),

    completedDocumentId: row.completed_document_id,

    createdBy: row.created_by_name,

    createdAt: row.created_at,
  }
}

function loadEnvelope(tenantId: string, id: string): EnvelopeRow | undefined {
  return get<EnvelopeRow>(
    "SELECT * FROM doc_envelopes WHERE tenant_id = ? AND id = ?",

    tenantId,

    id,
  )
}

/** GET /api/signatures/envelopes */

export async function listEnvelopes(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "view")

  const rows = all<EnvelopeRow>(
    `SELECT * FROM doc_envelopes WHERE tenant_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 200`,

    guarded.tenantId,
  )

  return { envelopes: rows.map(toEnvelopeView) } satisfies EnvelopeListResponse
}

interface DraftRecipient {
  name: string

  email: string

  role: string

  signOrder: number
}

function parseRecipients(
  raw: unknown,

  errors: Record<string, string>,
): DraftRecipient[] {
  const list = Array.isArray(raw) ? raw : []

  if (list.length < RECIPIENTS_MIN) {
    errors.recipients = "Add at least one recipient."

    return []
  }

  if (list.length > RECIPIENTS_MAX) {
    errors.recipients = `Use ${RECIPIENTS_MAX} recipients or fewer.`

    return []
  }

  const drafted: DraftRecipient[] = []

  for (const [index, entry] of list.entries()) {
    const item = (entry ?? {}) as Record<string, unknown>

    const name = typeof item.name === "string" ? item.name.trim() : ""

    const email =
      typeof item.email === "string" ? item.email.trim().toLowerCase() : ""

    const role =
      typeof item.role === "string" && isRecipientRole(item.role)
        ? item.role
        : "signer"

    if (name === "") errors[`recipient${index}Name`] = "A name is required."

    if (email === "" || !email.includes("@"))
      errors[`recipient${index}Email`] = "A valid email is required."

    const signOrder = Number.isSafeInteger(item.signOrder)
      ? Number(item.signOrder)
      : index + 1

    drafted.push({ name, email, role, signOrder })
  }

  return drafted
}

/**
 * Resolve a template body's merge tokens against sender-supplied values.
 * An unresolved token is left in place — the sender sees it in the preview and
 * fixes it; we never invent a value.
 */

function renderTemplate(
  bodyText: string,

  values: Record<string, unknown>,
): string {
  return bodyText.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    const value = values[key]

    if (value === undefined || value === null) return whole

    return String(value)
  })
}

/** POST /api/signatures/envelopes — a draft carrying its content and chain. */

export async function createEnvelope(
  ctx: RequestContext,
): Promise<EnvelopeMutationResponse> {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "create")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const errors: Record<string, string> = {}

  const title = typeof body.title === "string" ? body.title.trim() : ""

  if (title === "") errors.title = "Give this envelope a title."
  else if (title.length > ENVELOPE_TITLE_MAX)
    errors.title = `Use ${ENVELOPE_TITLE_MAX} characters or fewer.`

  const message = bounded(body.message, ENVELOPE_MESSAGE_MAX, "message", errors)

  const templateId =
    typeof body.templateId === "string" && body.templateId !== ""
      ? body.templateId
      : null

  const documentId =
    typeof body.documentId === "string" && body.documentId !== ""
      ? body.documentId
      : null

  const projectId =
    typeof body.projectId === "string" && body.projectId !== ""
      ? body.projectId
      : null

  let renderedBody = typeof body.body === "string" ? body.body : ""

  if (templateId) {
    const template = loadTemplate(guarded.tenantId, templateId)

    if (!template) throw notFound("That template does not exist")

    if (template.status !== "active") {
      throw conflict("Only a released (active) template can start an envelope.")
    }

    const values =
      typeof body.mergeValues === "object" && body.mergeValues !== null
        ? body.mergeValues as Record<string, unknown>
        : {}

    renderedBody = renderTemplate(template.body_text, values)
  }

  if (renderedBody.trim() === "" && !documentId) {
    errors.body = "The envelope needs text or an attached document."
  }

  if (renderedBody.length > TEMPLATE_BODY_MAX)
    errors.body = `Use ${TEMPLATE_BODY_MAX} characters or fewer.`

  const recipients = parseRecipients(body.recipients, errors)

  const recipientsHasSigner = recipients.some((r) => r.role === "signer")

  if (recipients.length > 0 && !recipientsHasSigner) {
    errors.recipients = "At least one recipient must be a signer."
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest("Check the highlighted fields", errors)
  }

  if (projectId) {
    const project = get<{ id: string }>(
      "SELECT id FROM projects WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      projectId,
    )

    if (!project) throw notFound("That project does not exist")
  }

  if (documentId) {
    const document = get<{ id: string }>(
      "SELECT id FROM documents WHERE tenant_id = ? AND id = ?",

      guarded.tenantId,

      documentId,
    )

    if (!document) throw notFound("That document does not exist")
  }

  const id = idFor("env")

  const stamp = now()

  transaction(() => {
    run(
      `INSERT INTO doc_envelopes (
          id, tenant_id, title, message, template_id, document_id, rendered_body,
          project_id, status, created_by_user_id, created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,

      id,

      guarded.tenantId,

      title,

      message,

      templateId,

      documentId,

      renderedBody,

      projectId,

      guarded.userId,

      guarded.session.user.fullName,

      stamp,
    )

    for (const recipient of recipients) {
      run(
        `INSERT INTO envelope_recipients (
            id, tenant_id, envelope_id, name, email, role, sign_order,
            status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,

        idFor("rcp"),

        guarded.tenantId,

        id,

        recipient.name,

        recipient.email,

        recipient.role,

        recipient.signOrder,

        stamp,
      )
    }
  })

  writeAudit(
    guarded,
    "signature.envelope.create",
    "signature",
    id,
    { title, recipients: recipients.length },
    ctx.ip,
  )

  return {
    ok: true,
    envelope: toEnvelopeView(loadEnvelope(guarded.tenantId, id)!),
  }
}

/** GET /api/signatures/envelopes/:id */

export async function getEnvelope(ctx: RequestContext) {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "view")

  const row = loadEnvelope(guarded.tenantId, ctx.params.envelopeId!)

  if (!row) throw notFound("That envelope does not exist")

  return { envelope: toEnvelopeView(row) }
}

/**
 * POST /api/signatures/envelopes/:id/send — mint the token and open the links.
 * The plaintext token exists only in the returned links; the row keeps its
 * digest. Sending from draft is `edit`; a re-send refreshes the token so the old
 * links die with it.
 */

export async function sendEnvelope(
  ctx: RequestContext,
): Promise<EnvelopeSendResponse> {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "edit")

  const row = loadEnvelope(guarded.tenantId, ctx.params.envelopeId!)

  if (!row) throw notFound("That envelope does not exist")

  if (row.status !== "draft" && row.status !== "sent") {
    throw conflict("Only a draft or already-sent envelope can be sent.")
  }

  const recipients = recipientsOf(row.id)

  const signers = recipients.filter((r) => r.role === "signer")

  if (signers.length === 0) {
    throw conflict("Add at least one signer before sending.")
  }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req).catch(
    () => ({}) as Record<string, unknown>,
  )

  const ttlInput = body.ttlDays

  let ttlDays: number | null = null

  if (ttlInput !== undefined && ttlInput !== null && ttlInput !== "") {
    const parsed = Number(ttlInput)

    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 1 ||
      parsed > ENVELOPE_TTL_DAYS_MAX
    ) {
      throw badRequest("The link window must be between 1 and 90 days.", {
        ttlDays: `Use 1-${ENVELOPE_TTL_DAYS_MAX} days.`,
      })
    }

    ttlDays = parsed
  }

  const token = generateToken(24)

  const tokenHash = hashToken(token)

  const stamp = now()

  transaction(() => {
    run(
      `UPDATE doc_envelopes
          SET status = 'sent', token_hash = ?, sent_at = ?, expires_at = ?
        WHERE tenant_id = ? AND id = ?`,

      tokenHash,

      stamp,

      daysFromNow(ttlDays),

      guarded.tenantId,

      row.id,
    )

    // Fresh links reset the chain: a re-send reopens signers to `pending` so

    // the old, dead token cannot leave someone marked `opened`.

    for (const recipient of recipients) {
      if (recipient.role !== "signer") continue

      if (recipient.status === "signed") continue

      run(
        `UPDATE envelope_recipients SET status = 'pending', opened_at = NULL
          WHERE id = ?`,

        recipient.id,
      )
    }
  })

  writeAudit(
    guarded,
    "signature.envelope.send",
    "signature",
    row.id,
    { title: row.title },
    ctx.ip,
  )

  const links = signers.map((recipient) => ({
    recipientId: recipient.id,

    name: recipient.name,

    path: `/sign/${token}?recipientId=${recipient.id}`,
  }))

  const refreshed = loadEnvelope(guarded.tenantId, row.id)!

  return { ok: true, envelope: toEnvelopeView(refreshed), links }
}

/** POST /api/signatures/envelopes/:id/void — revoke the token, close the door. */

export async function voidEnvelope(
  ctx: RequestContext,
): Promise<EnvelopeMutationResponse> {
  const guarded = requirePermission(requireAuth(ctx), "signatures", "edit")

  const row = loadEnvelope(guarded.tenantId, ctx.params.envelopeId!)

  if (!row) throw notFound("That envelope does not exist")

  if (row.status === "completed") {
    throw conflict("A completed envelope cannot be voided.")
  }

  if (row.status === "void") return { ok: true, envelope: toEnvelopeView(row) }

  const body = await readJsonBody<Record<string, unknown>>(ctx.req).catch(
    () => ({}) as Record<string, unknown>,
  )

  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  transaction(() => {
    // A voided envelope keeps its token digest so any late use is rejected, but

    // a fresh unique digest could not collide; we null the token so the old link

    // resolves to nothing at all.

    run(
      `UPDATE doc_envelopes SET status = 'void', void_reason = ?, token_hash = NULL
        WHERE tenant_id = ? AND id = ?`,

      reason || null,

      guarded.tenantId,

      row.id,
    )
  })

  writeAudit(
    guarded,
    "signature.envelope.void",
    "signature",
    row.id,
    { reason: reason || null },
    ctx.ip,
  )

  return {
    ok: true,
    envelope: toEnvelopeView(loadEnvelope(guarded.tenantId, row.id)!),
  }
}

// --- The public ceremony (token-authorised, no session) --------------------

/**
 * Writes an audit row for a ceremony event. The actor is a recipient, not a
 * workspace user, so `writeAudit` (which needs a session tenant) cannot be used;
 * we insert directly with the envelope's tenant and a null actor id.
 */

function auditCeremony(
  tenantId: string,

  action: string,

  targetId: string,

  detail: Record<string, unknown>,

  ip: string | null,
): void {
  run(
    `INSERT INTO audit_log (
        id, tenant_id, actor_user_id, actor_email, action,
        target_type, target_id, detail, ip_address, created_at
     ) VALUES (?, ?, NULL, ?, ?, 'signature', ?, ?, ?, ?)`,

    idFor("aud"),

    tenantId,

    typeof detail.email === "string" ? detail.email : null,

    action,

    targetId,

    JSON.stringify(detail),

    ip,

    now(),
  )
}

function findEnvelopeByToken(rawToken: string): EnvelopeRow | undefined {
  const tokenHash = hashToken(rawToken)

  return get<EnvelopeRow>(
    "SELECT * FROM doc_envelopes WHERE token_hash = ? AND status <> 'void'",

    tokenHash,
  )
}

function findRecipient(
  envelopeId: string,
  recipientId: string,
): RecipientRow | undefined {
  return get<RecipientRow>(
    "SELECT * FROM envelope_recipients WHERE envelope_id = ? AND id = ?",

    envelopeId,

    recipientId,
  )
}

/**
 * GET /api/sign/:token?recipientId= — the recipient's view of the envelope.
 * The first successful open moves a `pending` signer to `opened`, a fact about a
 * click worth keeping. Nothing here leaks another signer's token or the
 * workspace's other records.
 */

export async function getSigningCeremony(
  ctx: RequestContext,
): Promise<SigningCeremonyView> {
  const token = ctx.params.token ?? ""

  const recipientId = ctx.query.get("recipientId") ?? ""

  const envelope = findEnvelopeByToken(token)

  if (!envelope) throw notFound("That signing link is not valid")

  const recipient = findRecipient(envelope.id, recipientId)

  if (!recipient || recipient.tenant_id !== envelope.tenant_id) {
    throw notFound("That signing link is not valid")
  }

  const status = effectiveStatus(envelope.status, envelope.expires_at)

  // First-open stamp, guarded so a signed/declined recipient is never rolled back.

  if (recipient.status === "pending") {
    run(
      `UPDATE envelope_recipients SET status = 'opened', opened_at = ? WHERE id = ?`,

      now(),

      recipient.id,
    )

    recipient.status = "opened"

    recipient.opened_at = now()

    auditCeremony(
      envelope.tenant_id,
      "signature.opened",
      envelope.id,
      { recipientId: recipient.id, email: recipient.email },
      ctx.ip,
    )
  }

  const canSign =
    status === "sent" &&
    recipient.role === "signer" &&
    (recipient.status === "pending" || recipient.status === "opened")

  return {
    envelope: {
      id: envelope.id,

      title: envelope.title,

      message: envelope.message,

      body: envelope.rendered_body,

      status,

      signOrder: Number(recipient.sign_order),
    },

    me: {
      recipientId: recipient.id,

      name: recipient.name,

      email: recipient.email,

      role: recipient.role,

      status: recipient.status,

      statusLabel:
        RECIPIENT_STATUS_LABELS[
          ((isRecipientStatusValue(recipient.status)
            ? recipient.status
            : "pending") as RecipientStatus)
        ],
    },

    chain: recipientsOf(envelope.id).map(toRecipientView),

    canSign,

    documentDownloadPath: envelope.completed_document_id
      ? `/api/documents/${envelope.completed_document_id}/file`
      : null,
  }
}

/**
 * POST /api/sign/:token/sign — the ceremony itself. `sign` records the typed
 * name, the instant, and the IP; `decline` records a reason. A `cc` recipient is
 * never a signer. When the last signer signs, the envelope completes and its
 * rendered agreement — with the signer chain — is written back into `documents`.
 */

export async function signCeremony(
  ctx: RequestContext,
): Promise<CeremonyActionResponse> {
  const token = ctx.params.token ?? ""

  const envelope = findEnvelopeByToken(token)

  if (!envelope) throw notFound("That signing link is not valid")

  const body = await readJsonBody<Record<string, unknown>>(ctx.req)

  const recipientId =
    typeof body.recipientId === "string" ? body.recipientId : ""

  const recipient = findRecipient(envelope.id, recipientId)

  if (!recipient || recipient.tenant_id !== envelope.tenant_id) {
    throw notFound("That signing link is not valid")
  }

  const status = effectiveStatus(envelope.status, envelope.expires_at)

  if (status !== "sent") {
    throw conflict(
      status === "completed"
        ? "This envelope is already completed."
        : "This signing link is no longer open.",
    )
  }

  if (recipient.role !== "signer") {
    throw forbidden("A copy recipient cannot sign.", "cc_cannot_sign")
  }

  if (recipient.status === "signed") {
    throw conflict("You have already signed this envelope.")
  }

  const action = body.action === "decline" ? "decline" : "sign"

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : ""

  const note = typeof body.message === "string" ? body.message.trim() : ""

  if (fullName === "" || fullName.length > ENVELOPE_TITLE_MAX) {
    throw badRequest("Type your full name to sign.", {
      fullName: fullName === "" ? "Required." : "Too long.",
    })
  }

  const stamp = now()

  if (action === "decline") {
    run(
      `UPDATE envelope_recipients
          SET status = 'declined', decline_reason = ?, signed_ip = ?, opened_at = COALESCE(opened_at, ?)
        WHERE id = ?`,

      note || null,

      ctx.ip,

      stamp,

      recipient.id,
    )

    auditCeremony(
      envelope.tenant_id,
      "signature.declined",
      envelope.id,
      { recipientId: recipient.id, email: recipient.email },
      ctx.ip,
    )

    const updated = findRecipient(envelope.id, recipient.id)!

    return {
      ok: true,

      me: ceremonyMe(updated),

      status: effectiveStatus(
        loadEnvelope(envelope.tenant_id, envelope.id)!.status,
        envelope.expires_at,
      ),

      completedDocumentId: null,
    }
  }

  // Sign, then decide completion inside one transaction so a half-signed chain

  // never reads as complete and vice versa.

  let completedDocumentId: string | null = null

  let finalEnvelope: EnvelopeRow | undefined

  transaction(() => {
    run(
      `UPDATE envelope_recipients
          SET status = 'signed', signed_name = ?, signed_at = ?, signed_ip = ?,
              opened_at = COALESCE(opened_at, ?)
        WHERE id = ?`,

      fullName,

      stamp,

      ctx.ip,

      stamp,

      recipient.id,
    )

    const signers = recipientsOf(envelope.id).filter((r) => r.role === "signer")

    const everyoneSigned = signers.every(
      (r) => r.id === recipient.id || r.status === "signed",
    )

    if (everyoneSigned) {
      completedDocumentId = fileCompletedAgreement(envelope, stamp)

      run(
        `UPDATE doc_envelopes SET status = 'completed', completed_at = ?, completed_document_id = ?
          WHERE tenant_id = ? AND id = ?`,

        stamp,

        completedDocumentId,

        envelope.tenant_id,

        envelope.id,
      )
    }

    finalEnvelope = loadEnvelope(envelope.tenant_id, envelope.id)!
  })

  auditCeremony(
    envelope.tenant_id,
    "signature.signed",
    envelope.id,
    { recipientId: recipient.id, email: recipient.email, fullName },
    ctx.ip,
  )

  const finalized = finalEnvelope!

  if (finalized.status === "completed") {
    auditCeremony(
      envelope.tenant_id,
      "signature.envelope_completed",
      finalized.id,
      { documentId: completedDocumentId },
      ctx.ip,
    )

    notifyRecipients(envelope.tenant_id, [finalized.created_by_user_id], {
      type: "envelope_completed",

      title: `Signature envelope "${finalized.title}" completed`,

      body: "Every signer has signed; the agreement is filed.",

      linkPath: "/signatures",

      actorName: fullName,
    })
  }

  const me = findRecipient(envelope.id, recipient.id)!

  return {
    ok: true,

    me: ceremonyMe(me),

    status: effectiveStatus(finalized.status, finalized.expires_at),

    completedDocumentId,
  }
}

function ceremonyMe(row: RecipientRow): SigningCeremonyView["me"] {
  return {
    recipientId: row.id,

    name: row.name,

    email: row.email,

    role: row.role,

    status: row.status,

    statusLabel:
      RECIPIENT_STATUS_LABELS[
        ((isRecipientStatusValue(row.status)
          ? row.status
          : "pending") as RecipientStatus)
      ],
  }
}

/**
 * Write the completed agreement back into `documents`, filed against the
 * envelope's project. Returns the new document id, or null when the envelope has
 * no project to file under — a null here is honest, not a hidden failure.
 */

function fileCompletedAgreement(
  envelope: EnvelopeRow,
  stamp: string,
): string | null {
  if (!envelope.project_id) return null

  const chain = recipientsOf(envelope.id).filter((r) => r.role === "signer")

  const signatureBlock = chain

    .map(
      (r) =>
        `${r.signed_name ?? r.name} <${r.email}> — signed ${r.signed_at ?? "n/a"} (IP ${r.signed_ip ?? "n/a"})`,
    )

    .join("\n")

  const document = `${envelope.rendered_body}\n\n---\nSigners\n${signatureBlock}\n\nEnvelope ${envelope.id}\nCompleted ${stamp}\n`

  const encoded = Buffer.from(document, "utf8").toString("base64")

  const dataUrl = `data:text/plain;base64,${encoded}`

  const id = idFor("doc")

  run(
    `INSERT INTO documents (
        id, tenant_id, entity_type, entity_id, doc_type, title, filename, mime,
        size_bytes, data, expires_at, uploaded_by_user_id, uploaded_by_name,
        created_at, updated_at
      ) VALUES (?, ?, 'project', ?, 'agreement', ?, ?, 'text/plain', ?, ?, NULL, ?, ?, ?, ?)`,

    id,

    envelope.tenant_id,

    envelope.project_id,

    `${envelope.title} (signed)`,

    `${envelope.title
      .slice(0, 60)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()}-signed.txt`,

    Buffer.byteLength(document, "utf8"),

    dataUrl,

    envelope.created_by_user_id,

    envelope.created_by_name,

    stamp,

    stamp,
  )

  return id
}
