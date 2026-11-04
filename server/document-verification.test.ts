/**
 * Customer Document Verification — guarantee tests.
 *
 * Each test maps to one of the eight "Verify" guarantees the module is judged on.
 * Everything runs against the real HTTP surface through the shared harness (a temp
 * database, the seeded demo workspace, and the live route guards), so an assertion
 * only passes when the actual endpoint behaves — never against a re-declared mock.
 *
 *   1. Booking block + audited override  (documents_required 409, then released)
 *   2. Maker-checker: an uploader cannot self-verify  (self_verification 403)
 *   3. Duplicate CNIC + duplicate file flagged across two customers
 *   4. Expiry alerts queue once (re-run does not duplicate); past-due shows expired
 *   5. Signed file door: unissued / expired / over-used / cross-tenant tokens fail
 *   6. CNIC masked for a non-permitted role; reveal gated + audited
 *   7. Tenant isolation: a second tenant reads nothing (404) through new endpoints
 *   8. Manual-only honesty: no auto-fill, never government-verified
 */

import { after, before, test } from "node:test"

import assert from "node:assert/strict"

import {
  TENANT_A,
  bootstrap,
  call,
  createSecondTenant,
  get,
  makeBookingFrame,
  run,
  setApprovalPolicy,
  signInAsRole,
} from "./test-harness.ts"

import type { CookieJar, Json } from "./test-harness.ts"

import { runDocumentExpiryScan } from "./jobs/document-reminders.ts"

let close: () => void

// A 1x1 transparent PNG. Placeholder bytes only — never a real identity image.

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const CNIC = "12345-1234567-1"

const CNIC_DIGITS = "1234512345671"

interface VerifyStamp {
  verification_status: string

  verified_via: string
}

before(async () => {
  close = (await bootstrap()).close
})

after(() => {
  close?.()
})

// --- helpers ---------------------------------------------------------------

async function newCustomer(
  cookies: CookieJar,

  fullName: string,

  phone: string,

  cnic?: string,
): Promise<string> {
  const result = await call(cookies, "POST", "/api/customers", {
    fullName,

    phone,

    customerType: "individual",

    ...(cnic ? { cnic } : {}),
  })

  assert.equal(result.status, 200, JSON.stringify(result.body))

  return result.body.customer.id as string
}

async function uploadDoc(
  cookies: CookieJar,

  customerId: string,

  checklistKey: string,

  title: string,

  identity: Json = {},
): Promise<Json> {
  const result = await call(
    cookies,
    "POST",
    `/api/customers/${customerId}/documents`,
    {
      checklistKey,

      title,

      filename: `${title}.png`,

      dataUrl: PNG,

      ...identity,
    },
  )

  assert.equal(result.status, 200, JSON.stringify(result.body))

  return result.body
}

function auditCount(action: string, targetId: string | null): number {
  const row = targetId
    ? get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = ? AND action = ? AND target_id = ?`,

        TENANT_A,

        action,

        targetId,
      )
    : get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = ? AND action = ?`,

        TENANT_A,

        action,
      )

  return row?.n ?? 0
}

// ---------------------------------------------------------------------------

// Guarantee 1 — booking block rule with an audited override.

// ---------------------------------------------------------------------------

test("a required document missing blocks the booking, and an approved override releases it", async () => {
  const owner = (await signInAsRole("tenant_owner", "block_owner")).cookies

  const clearer = (await signInAsRole("tenant_owner", "block_clearer")).cookies

  const enabled = await call(
    owner,
    "PATCH",
    "/api/settings/document-verification",
    {
      blockBooking: true,

      allowOverride: true,
    },
  )

  assert.equal(enabled.status, 200, JSON.stringify(enabled.body))

  await setApprovalPolicy(owner, "booking", false, 0)

  const frame = await makeBookingFrame(owner, {
    name: "Blocked Block",

    code: "BLK-1",

    phone: "+971501110001",
  })

  const bookingBody = {
    projectId: frame.projectId,

    unitId: frame.unitId,

    customerId: frame.customerId,

    bookingAmount: 100000,

    bookingDate: "2020-01-15",

    terms: "Blocked until documents verified.",
  }

  // Held: the required documents are not verified.

  const blocked = await call(owner, "POST", "/api/bookings", bookingBody)

  assert.equal(blocked.status, 409, JSON.stringify(blocked.body))

  assert.equal(blocked.body.error.code, "documents_required")

  // Override requested by one entitled person...

  const overrode = await call(owner, "POST", "/api/bookings", {
    ...bookingBody,

    overrideDocBlock: true,

    overrideReason: "Verified offline; office signed the exception.",
  })

  assert.equal(overrode.status, 200, JSON.stringify(overrode.body))

  assert.equal(overrode.body.pending, true)

  const approvalId = overrode.body.approval.id as string

  assert.ok(approvalId, "an override approval is raised")

  assert.ok(
    auditCount("project.booking.override_requested", approvalId) >= 1,

    "the override request is audited",
  )

  // ...and cleared by a *different* entitled person.

  const approved = await call(
    clearer,

    "POST",

    `/api/approvals/${approvalId}/approve`,

    { decisionNote: "Exception approved." },
  )

  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  assert.ok(
    auditCount("document.override.approved", frame.customerId) >= 1,

    "the override decision is audited",
  )

  // With the release token signed, the officer's retry proceeds.

  const retry = await call(owner, "POST", "/api/bookings", bookingBody)

  assert.equal(retry.status, 200, JSON.stringify(retry.body))

  assert.ok(retry.body.booking, "the booking finally lands")

  // Restore the default so later tests see an unblocked tenant.

  await call(owner, "PATCH", "/api/settings/document-verification", {
    blockBooking: false,
  })
})

// ---------------------------------------------------------------------------

// Guarantee 2 — maker-checker: the uploader cannot verify their own file.

// ---------------------------------------------------------------------------

test("an uploader cannot self-verify, but another entitled reviewer can", async () => {
  const uploader = (await signInAsRole("sales_manager", "mk_up")).cookies

  const reviewer = (await signInAsRole("sales_manager", "mk_ver")).cookies

  const customerId = await newCustomer(
    uploader,
    "Maker Checker",
    "+971502220002",
  )

  const created = await uploadDoc(
    uploader,
    customerId,
    "cnic_front",
    "Card front",
    {
      cnic: CNIC,
    },
  )

  const documentId = created.document.id as string

  const self = await call(
    uploader,
    "POST",
    `/api/documents/${documentId}/verify`,
    {},
  )

  assert.equal(self.status, 403, JSON.stringify(self.body))

  assert.equal(self.body.error.code, "self_verification")

  const other = await call(
    reviewer,
    "POST",
    `/api/documents/${documentId}/verify`,
    {},
  )

  assert.equal(other.status, 200, JSON.stringify(other.body))

  const stamped = get<VerifyStamp>(
    `SELECT verification_status, verified_via FROM documents WHERE id = ?`,

    documentId,
  )

  assert.equal(stamped?.verification_status, "verified")

  assert.equal(stamped?.verified_via, "manual")
})

// ---------------------------------------------------------------------------

// Guarantee 3 — duplicate CNIC and duplicate file flagged across two customers.

// ---------------------------------------------------------------------------

test("a shared CNIC fingerprint and a shared file are flagged as duplicates", async () => {
  const officer = (await signInAsRole("sales_manager", "dup_off")).cookies

  const customerA = await newCustomer(officer, "Dup A", "+971503330003")

  const customerB = await newCustomer(officer, "Dup B", "+971503330004")

  await uploadDoc(officer, customerA, "cnic_front", "First card", {
    cnic: CNIC,
  })

  const second = await uploadDoc(
    officer,
    customerB,
    "cnic_front",
    "Second card",
    {
      cnic: CNIC,
    },
  )

  assert.ok(second.flags.duplicateFile, "the identical bytes are flagged")

  assert.ok(second.flags.duplicateCnic, "the identical CNIC is flagged")

  // The match is another customer's file, never the one just uploaded.

  assert.notEqual(
    second.flags.duplicateCnic.documentId,

    second.document.id,

    "the CNIC match points at a different document",
  )

  assert.notEqual(
    second.flags.duplicateCnic.customerId,

    customerB,

    "the CNIC was seen on a different customer",
  )

  assert.notEqual(
    second.flags.duplicateFile.customerId,

    customerB,

    "the identical file was seen on a different customer",
  )
})

// ---------------------------------------------------------------------------

// Guarantee 4 — expiry alerts queue once; past-due shows expired.

// ---------------------------------------------------------------------------

test("expiry alerts are written once and never duplicated by a re-run", async () => {
  await runDocumentExpiryScan(TENANT_A, new Date().toISOString())

  const first =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM outbound_messages WHERE tenant_id = ? AND purpose = 'document_expiring'`,

      TENANT_A,
    )?.n ?? 0

  assert.ok(first >= 1, "the near-expiry seed rows queue at least one alert")

  await runDocumentExpiryScan(TENANT_A, new Date().toISOString())

  const again =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM outbound_messages WHERE tenant_id = ? AND purpose = 'document_expiring'`,

      TENANT_A,
    )?.n ?? 0

  assert.equal(again, first, "a re-run does not duplicate the ledger rows")
})

test("a document past its expiry date reads as expired on the checklist", async () => {
  const officer = (await signInAsRole("sales_manager", "exp_off")).cookies

  const view = await call(
    officer,

    "GET",

    "/api/customers/cus_demo_amna/document-checklist",
  )

  assert.equal(view.status, 200, JSON.stringify(view.body))

  const states = (view.body.entries as Json[]).map((entry) => entry.state)

  assert.ok(states.includes("expired"), "a past-due document shows as expired")
})

// ---------------------------------------------------------------------------

// Guarantee 5 — the signed file door refuses unissued/expired/over-used/cross-tenant.

// ---------------------------------------------------------------------------

test("guessed, expired, over-used, and cross-tenant file tokens release no bytes", async () => {
  const officer = (await signInAsRole("sales_manager", "fa_off")).cookies

  const customerId = await newCustomer(officer, "File Door", "+971504440005")

  const created = await uploadDoc(
    officer,
    customerId,
    "cnic_front",
    "Door card",
    {
      cnic: CNIC,
    },
  )

  const documentId = created.document.id as string

  // A guessed token that was never minted.

  const guessed = await call(null, "GET", "/api/file-access/notarealtoken123")

  assert.equal(guessed.status, 404)

  const newestGrantId = (): string =>
    get<{ id: string }>(
      `SELECT id FROM file_access_grants ORDER BY rowid DESC LIMIT 1`,
    )!.id

  // Expired.

  const viewAccess = await call(
    officer,
    "POST",
    `/api/documents/${documentId}/access`,
    {
      purpose: "view",
    },
  )

  assert.equal(viewAccess.status, 200, JSON.stringify(viewAccess.body))

  run(
    `UPDATE file_access_grants SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`,

    newestGrantId(),
  )

  const expired = await call(
    null,

    "GET",

    `/api/file-access/${viewAccess.body.access.token}`,
  )

  assert.equal(expired.status, 410)

  // Over-used (download hands the file once).

  const dlAccess = await call(
    officer,
    "POST",
    `/api/documents/${documentId}/access`,
    {
      purpose: "download",
    },
  )

  run(
    `UPDATE file_access_grants SET redeemed_count = max_uses WHERE id = ?`,

    newestGrantId(),
  )

  const overUsed = await call(
    null,

    "GET",

    `/api/file-access/${dlAccess.body.access.token}`,
  )

  assert.equal(overUsed.status, 410)

  // Cross-tenant: a grant re-pointed at a stranger tenant cannot read another's doc.

  // Create a real second workspace so the re-point satisfies the tenant foreign key;

  // the guard that matters is that the bytes' own tenant no longer matches the grant.

  await createSecondTenant("fagrid")

  const xAccess = await call(
    officer,
    "POST",
    `/api/documents/${documentId}/access`,
    {
      purpose: "view",
    },
  )

  run(
    `UPDATE file_access_grants SET tenant_id = 'tn_iso_fagrid' WHERE id = ?`,

    newestGrantId(),
  )

  const crossTenant = await call(
    null,

    "GET",

    `/api/file-access/${xAccess.body.access.token}`,
  )

  assert.equal(crossTenant.status, 404)
})

// ---------------------------------------------------------------------------

// Guarantee 6 — CNIC masked for a non-permitted role; gated + audited reveal.

// ---------------------------------------------------------------------------

test("a non-permitted role sees a masked CNIC and cannot reveal it", async () => {
  const officer = (await signInAsRole("sales_manager", "cnic_off")).cookies

  const customerId = await newCustomer(
    officer,

    "Masked Person",

    "+971505550006",

    CNIC,
  )

  const agent = (await signInAsRole("sales_agent", "cnic_agent")).cookies

  const asAgent = await call(agent, "GET", `/api/customers/${customerId}`)

  assert.equal(asAgent.status, 200, JSON.stringify(asAgent.body))

  assert.equal(
    asAgent.body.customer.cnic,
    null,
    "no plaintext for a non-editor",
  )

  assert.ok(
    String(asAgent.body.customer.cnicMasked).includes("X"),

    "the masked form keeps only the ends",
  )

  const created = await uploadDoc(
    officer,
    customerId,
    "cnic_front",
    "Mask card",
    {
      cnic: CNIC,
    },
  )

  const documentId = created.document.id as string

  const checklistAsAgent = await call(
    agent,

    "GET",

    `/api/customers/${customerId}/document-checklist`,
  )

  assert.equal(
    checklistAsAgent.status,
    200,
    JSON.stringify(checklistAsAgent.body),
  )

  assert.ok(
    !JSON.stringify(checklistAsAgent.body).includes(CNIC_DIGITS),

    "a list response never carries the raw CNIC",
  )

  const denied = await call(agent, "GET", `/api/documents/${documentId}/cnic`)

  assert.equal(denied.status, 403, JSON.stringify(denied.body))
})

test("a permitted reveal returns the plaintext and writes a cnic_revealed audit row", async () => {
  const uploader = (await signInAsRole("sales_manager", "rev_up")).cookies

  const revealer = (await signInAsRole("sales_manager", "rev_ver")).cookies

  const customerId = await newCustomer(
    uploader,
    "Reveal Person",
    "+971505550007",
  )

  const created = await uploadDoc(
    uploader,
    customerId,
    "cnic_front",
    "Reveal card",
    {
      cnic: CNIC,
    },
  )

  const documentId = created.document.id as string

  const revealed = await call(
    revealer,
    "GET",
    `/api/documents/${documentId}/cnic`,
  )

  assert.equal(revealed.status, 200, JSON.stringify(revealed.body))

  assert.equal(revealed.body.cnic, CNIC_DIGITS, "the stored value decrypts")

  assert.ok(
    auditCount("document.cnic_revealed", documentId) >= 1,

    "the reveal is audited against the document",
  )
})

// ---------------------------------------------------------------------------

// Guarantee 7 — tenant isolation on every new endpoint.

// ---------------------------------------------------------------------------

test("a second tenant cannot read the demo tenant's documents (404 everywhere)", async () => {
  const officer = (await signInAsRole("sales_manager", "iso_off")).cookies

  const customerId = await newCustomer(
    officer,
    "Foreign Owner",
    "+971506660008",
  )

  const created = await uploadDoc(
    officer,
    customerId,
    "cnic_front",
    "Foreign card",
    {
      cnic: CNIC,
    },
  )

  const documentId = created.document.id as string

  const intruder = (await createSecondTenant("docverify")).cookies

  const checks: [string, string][] = [
    ["GET", `/api/customers/${customerId}/document-checklist`],

    ["GET", `/api/documents/${documentId}/review`],

    ["GET", `/api/documents/${documentId}/cnic`],

    ["POST", `/api/documents/${documentId}/access`],
  ]

  for (const [method, path] of checks) {
    const probe = await call(
      intruder,
      method,
      path,
      method === "POST" ? { purpose: "view" } : undefined,
    )

    assert.equal(
      probe.status,
      404,
      `${method} ${path} must not leak across tenants`,
    )
  }
})

// ---------------------------------------------------------------------------

// Guarantee 8 — manual-only honesty.

// ---------------------------------------------------------------------------

test("with no OCR or identity provider, nothing is auto-filled or government-verified", async () => {
  const officer = (await signInAsRole("sales_manager", "honesty_off")).cookies

  const customerId = await newCustomer(
    officer,
    "Honesty Person",
    "+971507770009",
  )

  // No identity fields typed, and the manual OCR adapter returns nothing.

  const created = await uploadDoc(
    officer,
    customerId,
    "cnic_front",
    "Blank card",
  )

  const documentId = created.document.id as string

  assert.equal(created.ocrStatus, "none", "no engine suggested anything")

  const reviewer = (await signInAsRole("sales_manager", "honesty_ver")).cookies

  const review = await call(
    reviewer,
    "GET",
    `/api/documents/${documentId}/review`,
  )

  assert.equal(review.status, 200, JSON.stringify(review.body))

  assert.equal(review.body.extracted.name, null, "no auto-filled name")

  assert.equal(review.body.extracted.cnic, null, "no auto-filled CNIC")

  // Manual mode refuses a provider check rather than fabricating a verified state.

  const provider = await call(
    reviewer,

    "POST",

    `/api/documents/${documentId}/provider-verify`,

    {},
  )

  assert.equal(provider.status, 422, JSON.stringify(provider.body))

  const row = get<{ verified_via: string | null }>(
    `SELECT verified_via FROM documents WHERE id = ?`,

    documentId,
  )

  assert.notEqual(
    row?.verified_via,
    "provider",
    "never labelled government-verified",
  )
})
