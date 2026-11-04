/**
 * The operating half of the demo dataset: spend, sign-off, paperwork, support,
 * notifications and the audit trail.
 *
 * These rows are written last because they read everything the earlier domains
 * published — expenses point at the vendors and projects, documents are filed
 * against real customers and bookings, tickets hang off a booking, and the audit
 * rows describe events that actually happened in the seed.
 *
 * The legal vocabulary is respected rather than stretched: an expense category is
 * one of the four the schema allows (a "legal" fee is filed under office with the
 * advocate named in the description), and a notification type is one of the seven
 * the inbox understands.
 */

import { run } from "../db.ts"

import {
  dayMinus,
  demoEmail,
  seqId,
  stamp,
  write,
  type Demo,
  type VendorSeed,
} from "./common.ts"

import { writeApproval } from "./money.ts"

/** A placeholder file: a real, tiny PDF so a download actually opens. */

const PLACEHOLDER_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF"

const PLACEHOLDER_DATA_URL = `data:application/pdf;base64,${Buffer.from(
  PLACEHOLDER_PDF,

  "utf8",
).toString("base64")}`

const PLACEHOLDER_BYTES = Buffer.from(PLACEHOLDER_PDF, "utf8").length

/** The spend lines, per category, with the vendor that carried them. */

interface ExpenseSpec {
  category: "project" | "office" | "marketing" | "construction"

  description: string

  vendor: number | null

  min: number

  max: number

  weight: number
}

const EXPENSE_LINES: ExpenseSpec[] = [
  {
    category: "marketing",

    description: "Facebook and Instagram campaign spend",

    vendor: 0,

    min: 120_000,

    max: 480_000,

    weight: 5,
  },

  {
    category: "marketing",

    description: "Site hoardings and banner printing",

    vendor: 1,

    min: 40_000,

    max: 160_000,

    weight: 2,
  },

  {
    category: "marketing",

    description: "Property expo stall and collateral",

    vendor: null,

    min: 150_000,

    max: 400_000,

    weight: 1,
  },

  {
    category: "construction",

    description: "Road sub-base and excavation work",

    vendor: 2,

    min: 400_000,

    max: 1_600_000,

    weight: 4,
  },

  {
    category: "construction",

    description: "RCC structure material labour",

    vendor: 3,

    min: 600_000,

    max: 2_400_000,

    weight: 3,
  },

  {
    category: "construction",

    description: "Sewerage and drainage line work",

    vendor: 4,

    min: 250_000,

    max: 900_000,

    weight: 2,
  },

  {
    category: "project",

    description: "Site survey and demarcation",

    vendor: 5,

    min: 60_000,

    max: 240_000,

    weight: 3,
  },

  {
    category: "project",

    description: "Boundary wall development",

    vendor: 2,

    min: 180_000,

    max: 700_000,

    weight: 2,
  },

  {
    category: "office",

    description: "Rent and utilities, head office",

    vendor: 6,

    min: 220_000,

    max: 320_000,

    weight: 4,
  },

  {
    category: "office",

    description: "Advocate consultancy and file processing fees",

    vendor: 7,

    min: 50_000,

    max: 250_000,

    weight: 3,
  },

  {
    category: "office",

    description: "Stationery, printing and courier",

    vendor: null,

    min: 15_000,

    max: 70_000,

    weight: 3,
  },

  {
    category: "office",

    description: "Sales team site-visit transport",

    vendor: null,

    min: 20_000,

    max: 90_000,

    weight: 2,
  },
]

/** The support desk subjects, spread across the four ticket states. */

const TICKET_SUBJECTS = [
  "Question about the installment due date",

  "Request for a copy of the booking form",

  "Corner premium was charged twice",

  "Site visit appointment for the family",

  "Possession timeline for the tower",

  "Name spelling correction on the ledger",

  "Receipt not received after bank transfer",

  "Request to waive the late charge",
]

const TICKET_BODIES = [
  "Kindly confirm when the next line falls due and whether a part payment is allowed.",

  "Please share the signed form; the copy on the portal is not readable.",

  "The charge appears on two lines of the schedule. Please check and correct it.",

  "We would like to visit on a weekend with the family before the booking is finalised.",

  "Please confirm the expected handover month for the block in writing.",

  "The ledger shows the middle name short; please match it to the CNIC.",

  "The transfer went through but no receipt was emailed to me.",

  "The bank held the transfer for a week; the delay was not mine.",
]

const CUSTOMER_REPLIES = [
  "Thank you. I have paid the amount again today; please confirm.",

  "The visit worked well. Please send the plan for the corner unit.",

  "Not resolved yet — the ledger still shows the old spelling.",
]

const STAFF_REPLIES = [
  "Checked against the schedule; the next line is due at the end of this month.",

  "A clean copy has been re-filed on your account.",

  "The duplicate charge has been removed and the ledger corrected.",

  "Noted. The site office will call you with two weekend slots.",
]

/** Writes spend, approvals, paperwork, support, notifications and the audit trail. */

export function seedOperations(demo: Demo): void {
  seedExpenses(demo)

  seedQueueApprovals(demo)

  seedDocuments(demo)

  seedTickets(demo)

  seedNotifications(demo)

  seedAudit(demo)
}

/**
 * Forty-two expenses over twelve months, most of them settled.
 *
 * Each one carries the approval that let it through, because the application
 * never pays an expense without a second pair of eyes; the three still waiting
 * are the queue a finance user sees on arrival. A paid expense with a vendor also
 * writes the vendor-ledger payment the route writes, so the vendor statements
 * balance too.
 */

function seedExpenses(demo: Demo): void {
  const candidates: ExpenseSpec[] = []

  for (const spec of EXPENSE_LINES) {
    for (let i = 0; i < spec.weight; i += 1) candidates.push(spec)
  }

  const maker = demo.roleUsers.get("accounts_officer")?.[0] ?? demo.actorUserId

  const approver = demo.roleUsers.get("tenant_admin")?.[0] ?? demo.actorUserId

  for (let index = 0; index < 42; index += 1) {
    const spec = demo.rand.pick(candidates)

    const id = seqId(demo, "exp")

    const backMonths = demo.rand.int(0, 11)

    const occurredAt = dayMinus(
      addMonthsToToday(demo, -backMonths),

      demo.rand.int(0, 20),
    )

    const status = expenseStatus(demo, index)

    const vendor: VendorSeed | null =
      spec.vendor === null ? null : (demo.vendors[spec.vendor] ?? null)

    const project =
      spec.category === "construction" || spec.category === "project"
        ? (demo.projects[index % Math.max(1, demo.projects.length)] ?? null)
        : null

    const amount = demo.rand.money(spec.min, spec.max)

    const decision =
      status === "paid" || status === "approved" || status === "rejected"
        ? {
            userId: approver,

            name: demo.userNames.get(approver) ?? demo.actorName,

            note:
              status === "rejected"
                ? "Invoice did not match the agreed rate; sent back to the vendor."
                : "Verified against the vendor invoice and the running rate.",

            at: stamp(
              demo.today,
              Math.max(0, daysBack(demo, occurredAt) - 3),
              15,
            ),
          }
        : undefined

    const approvalId = writeApproval(
      demo,

      "expense",

      status === "pending_approval"
        ? "pending"
        : status === "rejected"
          ? "rejected"
          : "approved",

      `${demo.currency} ${amount.toLocaleString("en-US")} — ${spec.description}`,

      {
        expenseId: id,

        category: spec.category,

        vendorName: vendor?.name ?? null,

        projectName: project?.name ?? null,

        amount,

        currency: demo.currency,

        description: spec.description,

        occurredAt,
      },

      "expense",

      id,

      maker,

      stamp(demo.today, Math.max(0, daysBack(demo, occurredAt) - 5), 10),

      decision,
    )

    const paidAt = status === "paid" ? occurredAt : null

    write(demo, "expenses", id, () =>
      run(
        `INSERT INTO expenses (
           id, tenant_id, category, project_id, vendor_id, description, amount,
           currency, occurred_at, status, approval_id, paid_at,
           created_by_user_id, created_by_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        spec.category,

        project?.id ?? null,

        vendor?.id ?? null,

        spec.description,

        amount,

        demo.currency,

        occurredAt,

        status,

        approvalId,

        paidAt,

        maker,

        demo.userNames.get(maker) ?? demo.actorName,

        stamp(demo.today, daysBack(demo, occurredAt), 10),

        stamp(demo.today, Math.max(0, daysBack(demo, occurredAt) - 1), 16),
      ),
    )

    if (status !== "paid" || !vendor) continue

    const ledgerId = seqId(demo, "vled")

    write(demo, "vendor_ledger_entries", ledgerId, () =>
      run(
        `INSERT INTO vendor_ledger_entries (
           id, tenant_id, vendor_id, invoice_id, expense_id, contract_id, kind,
           amount, currency, reference, source_type, source_id, occurred_at, note,
           recorded_by_user_id, recorded_by_name, created_at
         ) VALUES (?, ?, ?, NULL, ?, NULL, 'payment', ?, ?, ?, 'expense', ?, ?, ?, ?, ?, ?)`,

        ledgerId,

        demo.tenantId,

        vendor.id,

        id,

        -amount,

        demo.currency,

        id,

        id,

        occurredAt,

        spec.description,

        maker,

        demo.userNames.get(maker) ?? demo.actorName,

        stamp(demo.today, daysBack(demo, occurredAt), 10),
      ),
    )
  }
}

/**
 * Where a row sits in its lifecycle.
 *
 * The first rows of the run are settled history; three sit in the queue and two
 * have been signed off but not yet paid, which is what the finance dashboard
 * needs to be able to show something in every state.
 */

function expenseStatus(demo: Demo, index: number): string {
  if (index === 4 || index === 17 || index === 29) return "pending_approval"

  if (index === 9 || index === 22) return "approved"

  if (index === 13 || index === 34) return "rejected"

  return demo.rand.chance(0.9) ? "paid" : "approved"
}

/** Whole days from today back to a `YYYY-MM-DD` day. */

function daysBack(demo: Demo, day: string): number {
  const ms =
    Date.parse(`${demo.today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)

  return Math.max(0, Math.round(ms / 86_400_000))
}

/** The same day of the month, `months` away from today. */

function addMonthsToToday(demo: Demo, months: number): string {
  const [year, month, day] = demo.today.split("-").map(Number)

  const total = month - 1 + months

  const targetYear = year + Math.floor(total / 12)

  const targetMonth = (((total % 12) + 12) % 12) + 1

  const last = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()

  const pad = (n: number) => String(n).padStart(2, "0")

  return `${pad(targetYear)}-${pad(targetMonth)}-${pad(Math.min(day!, last))}`
}

/** One request waiting in the approvals queue. */

interface QueueItem {
  action: string

  summary: string

  payload: Record<string, unknown>

  entity: string

  targetId: string | null
}

/**
 * The requests a manager opens the approvals page to find.
 *
 * Each carries the payload shape the detail page decodes, and the queue is
 * deliberately mixed: a discount and an exceptional-price request (actions the
 * vocabulary already carries), a booking held before it is made, a cancellation
 * waiting on the money rules, and a refund that has not been signed.
 */

function seedQueueApprovals(demo: Demo): void {
  const agent = demo.agents[0]

  const requester = demo.agents[2] ?? agent

  const booking = demo.bookings.find((row) => row.status === "confirmed")

  const heldUnit = demo.units.find((unit) => unit.status === "available")

  const requestedDaysAgo = [1, 2, 3, 4, 5, 6, 7]

  const queue: QueueItem[] = []

  if (booking) {
    queue.push({
      action: "discount",

      summary: `Release a ${demo.currency} 250,000 corner-premium concession on ${booking.unitCode}`,

      payload: {
        customerId: booking.customerId,

        customerName: booking.customerName,

        unitCode: booking.unitCode,

        requestedDiscount: 250_000,

        reason: "Buyer is taking a second unit in the same block",
      },

      entity: "booking",

      targetId: booking.id,
    })

    queue.push({
      action: "exceptional_pricing",

      summary: `List ${booking.unitCode} below the published rate for a bulk deal`,

      payload: {
        customerId: booking.customerId,

        customerName: booking.customerName,

        unitCode: booking.unitCode,

        requestedAmount: Math.round(booking.amount * 0.94),

        reason: "Two-plot package agreed at the site office",
      },

      entity: "booking",

      targetId: booking.id,
    })

    queue.push({
      action: "cancellation",

      summary: `Cancel ${booking.reference} and refund on the rules`,

      payload: {
        bookingId: booking.id,

        reference: booking.reference,

        customerName: booking.customerName,

        reason: "Buyer's finance application was declined by the bank",

        chargeAmount: 50_000,

        refundAmount: Math.min(450_000, booking.amount),
      },

      entity: "booking",

      targetId: booking.id,
    })

    queue.push({
      action: "refund",

      summary: `Refund ${demo.currency} 120,000 of an over-collected installment`,

      payload: {
        refundId: seqId(demo, "ref"),

        customerId: booking.customerId,

        customerName: booking.customerName,

        reference: booking.reference,

        amount: 120_000,

        reason: "The buyer paid the same line twice at the site office",
      },

      entity: "refund",

      targetId: null,
    })
  }

  if (heldUnit) {
    queue.push({
      action: "booking",

      summary: `Book ${heldUnit.code} for ${demo.customers[3]?.fullName ?? "a walk-in buyer"}`,

      payload: {
        projectId: heldUnit.projectId,

        unitId: heldUnit.id,

        customerId: demo.customers[3]?.id ?? demo.customers[0]!.id,

        agentUserId: agent?.userId ?? null,

        dealerId: null,

        quoteId: null,

        bookingAmount: heldUnit.price,

        bookingDate: demo.today,

        terms: "Booking subject to approval; plan confirmed on sign-off.",

        notes:
          "Requested at the site office; above the auto-approve threshold.",

        unitCode: heldUnit.code,

        customerName:
          demo.customers[3]?.fullName ?? demo.customers[0]!.fullName,
      },

      entity: "booking",

      targetId: null,
    })

    queue.push({
      action: "booking",

      summary: `Book a second unit for the same buyer on a longer plan`,

      payload: {
        projectId: heldUnit.projectId,

        unitId: heldUnit.id,

        customerId: demo.customers[4]?.id ?? demo.customers[0]!.id,

        agentUserId: requester?.userId ?? null,

        dealerId: demo.dealers[0]?.id ?? null,

        quoteId: null,

        bookingAmount: heldUnit.price,

        bookingDate: demo.today,

        terms: "Booking subject to approval; dealer commission applies.",

        notes: "Sourced through the channel-partner network.",

        unitCode: heldUnit.code,

        customerName:
          demo.customers[4]?.fullName ?? demo.customers[0]!.fullName,
      },

      entity: "booking",

      targetId: null,
    })
  }

  queue.forEach((item, index) => {
    const at = stamp(
      demo.today,
      requestedDaysAgo[index % requestedDaysAgo.length] ?? 1,
      11,
    )

    writeApproval(
      demo,

      item.action,

      "pending",

      item.summary,

      item.payload,

      item.entity,

      item.targetId,

      index % 2 === 0
        ? (agent?.userId ?? demo.actorUserId)
        : (requester?.userId ?? demo.actorUserId),

      at,
    )
  })
}

/** A document kind, with the filename tail it gives the placeholder file. */

interface DocShape {
  type: string

  title: string

  suffix: string
}

/** The thing a placeholder file is filed against. */

interface DocTarget {
  entity: string

  id: string

  label: string

  kind: number
}

/**
 * Two documents per customer for a slice of the book, plus the scheme's own
 * papers: placeholder files only, never real content.
 */

function seedDocuments(demo: Demo): void {
  const uploader = demo.agents[0]

  const spec: DocShape[] = [
    { type: "id_copy", title: "CNIC copy", suffix: "cnic" },

    { type: "booking_form", title: "Signed booking form", suffix: "booking" },

    { type: "agreement", title: "Allotment agreement", suffix: "agreement" },
  ]

  const targets: DocTarget[] = []

  demo.customers.slice(0, 12).forEach((customer, index) => {
    targets.push({
      entity: "customer",

      id: customer.id,

      label: customer.fullName,

      kind: index % spec.length,
    })
  })

  demo.bookings.slice(0, 10).forEach((booking, index) => {
    targets.push({
      entity: "booking",

      id: booking.id,

      label: booking.reference,

      kind: (index + 1) % spec.length,
    })
  })

  for (const project of demo.projects) {
    targets.push({
      entity: "project",

      id: project.id,

      label: project.name,

      kind: 2,
    })
  }

  targets.forEach((target, index) => {
    const id = seqId(demo, "doc")

    const shape = spec[target.kind]!

    const days = Math.max(1, 300 - index * 8)

    const at = stamp(demo.today, days, 12)

    const filename = `${target.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${shape.suffix}.pdf`

    write(demo, "documents", id, () =>
      run(
        `INSERT INTO documents (
           id, tenant_id, entity_type, entity_id, doc_type, title, filename, mime,
           size_bytes, data, expires_at, uploaded_by_user_id, uploaded_by_name,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, NULL, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        target.entity,

        target.id,

        shape.type,

        `${shape.title} — ${target.label}`,

        filename,

        PLACEHOLDER_BYTES,

        PLACEHOLDER_DATA_URL,

        uploader?.userId ?? demo.actorUserId,

        uploader?.fullName ?? demo.actorName,

        at,

        at,
      ),
    )
  })
}

/**
 * The support desk: eight tickets across all four states, with a reply thread on
 * the ones that have been worked.
 *
 * `sla_due_by` follows the priority the same way the route derives it, so the
 * open ones show a real deadline rather than an arbitrary date.
 */

function seedTickets(demo: Demo): void {
  const staff = demo.roleUsers.get("tenant_admin")?.[0] ?? demo.actorUserId

  const states = [
    "open",

    "in_progress",

    "in_progress",

    "open",

    "resolved",

    "closed",

    "resolved",

    "in_progress",
  ]

  const priorities = [
    "normal",
    "urgent",
    "high",
    "low",
    "normal",
    "high",
    "normal",
    "urgent",
  ]

  const slaDays: Record<string, number> = {
    low: 5,
    normal: 3,
    high: 2,
    urgent: 1,
  }

  demo.bookings.slice(0, 8).forEach((booking, index) => {
    const id = seqId(demo, "tkt")

    const status = states[index] ?? "open"

    const priority = priorities[index] ?? "normal"

    const createdDaysAgo = Math.max(2, 120 - index * 13)

    const createdAt = stamp(demo.today, createdDaysAgo, 14)

    const resolvedAt =
      status === "resolved" || status === "closed"
        ? stamp(demo.today, Math.max(0, createdDaysAgo - 2), 16)
        : null

    const assignee =
      status === "closed"
        ? null
        : (demo.roleUsers.get("sales_manager")?.[index % 2] ?? null)

    write(demo, "support_tickets", id, () =>
      run(
        `INSERT INTO support_tickets (
           id, tenant_id, customer_id, booking_id, subject, description, status,
           priority, assignee_user_id, sla_due_by, raised_by, created_by_user_id,
           created_by_name, created_at, updated_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'customer', ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        booking.customerId,

        booking.id,

        TICKET_SUBJECTS[index % TICKET_SUBJECTS.length],

        TICKET_BODIES[index % TICKET_BODIES.length],

        status,

        priority,

        assignee,

        dayMinus(dayFromStamp(createdAt), slaDays[priority] ?? 3),

        booking.customerId,

        booking.customerName,

        createdAt,

        resolvedAt ?? stamp(demo.today, Math.max(0, createdDaysAgo - 1), 9),

        resolvedAt,
      ),
    )

    const replies = status === "open" ? 1 : index % 3 === 0 ? 4 : 2

    for (let step = 0; step < replies; step += 1) {
      const commentId = seqId(demo, "tcc")

      const fromCustomer = step % 2 === 0

      const at = stamp(
        demo.today,

        Math.max(0, createdDaysAgo - step * 2 - 1),

        fromCustomer ? 18 : 10,
      )

      const body = fromCustomer
        ? (CUSTOMER_REPLIES[step % CUSTOMER_REPLIES.length] ??
          TICKET_BODIES[index % TICKET_BODIES.length])
        : (STAFF_REPLIES[step % STAFF_REPLIES.length] ??
          "Noted and actioned with the site office.")

      write(demo, "ticket_comments", commentId, () =>
        run(
          `INSERT INTO ticket_comments (
             id, tenant_id, ticket_id, author_kind, author_user_id, author_name,
             body, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,

          commentId,

          demo.tenantId,

          id,

          fromCustomer ? "customer" : "staff",

          fromCustomer ? null : staff,

          fromCustomer
            ? booking.customerName
            : (demo.userNames.get(staff) ?? demo.actorName),

          body,

          at,
        ),
      )
    }
  })
}

function dayFromStamp(value: string): string {
  return value.slice(0, 10)
}

/** An in-app inbox row, addressed to one person. */

interface NotificationShape {
  user: string

  type: string

  title: string

  body: string

  link: string
}

/**
 * The inbox: a booking confirmation, a receipt, an approval request and a
 * document, addressed to the people who would actually have received them.
 *
 * Only the seven types the table understands are used, and a read flag is set on
 * the older ones so the badge count is not the whole list.
 */

function seedNotifications(demo: Demo): void {
  const officer =
    demo.roleUsers.get("accounts_officer")?.[0] ?? demo.actorUserId

  const manager = demo.managers[0]?.userId ?? demo.actorUserId

  const owner = demo.roleUsers.get("tenant_owner")?.[0] ?? demo.actorUserId

  const shapes: NotificationShape[] = [
    {
      user: manager,

      type: "booking_confirmed",

      title: "Booking confirmed on Rowan Valley Gardens",

      body: "A plot was booked on the monthly plan; the schedule has been generated.",

      link: "/bookings",
    },

    {
      user: officer,

      type: "payment_recorded",

      title: "Receipt issued against an installment",

      body: "A bank transfer was allocated to the next line of a running schedule.",

      link: "/payments",
    },

    {
      user: owner,

      type: "approval_requested",

      title: "Approval needed: discount",

      body: "A corner-premium concession is waiting on a second sign-off.",

      link: "/approvals",
    },

    {
      user: manager,

      type: "document_uploaded",

      title: "CNIC copy filed on a customer record",

      body: "The site office uploaded the identity document for a new buyer.",

      link: "/customers",
    },

    {
      user: officer,

      type: "booking_confirmed",

      title: "Two bookings closed this month",

      body: "The sales desk recorded two new bookings; schedules are ready to collect.",

      link: "/bookings",
    },

    {
      user: owner,

      type: "payment_recorded",

      title: "A late line was settled",

      body: "An installment that had gone past due was cleared with a bank transfer.",

      link: "/collections",
    },
  ]

  demo.bookings.slice(0, 12).forEach((booking, index) => {
    const shape = shapes[index % shapes.length]!

    const id = seqId(demo, "ntf")

    const days = Math.max(0, 200 - index * 15)

    const at = stamp(demo.today, days, 13)

    const readAt =
      index > 5 ? stamp(demo.today, Math.max(0, days - 2), 9) : null

    write(demo, "notifications", id, () =>
      run(
        `INSERT INTO notifications (
           id, tenant_id, user_id, type, channel, title, body, link_path,
           actor_user_id, actor_name, read_at, created_at
         ) VALUES (?, ?, ?, ?, 'in_app', ?, ?, ?, ?, ?, ?, ?)`,

        id,

        demo.tenantId,

        shape.user,

        shape.type,

        shape.title,

        shape.body,

        shape.link,

        booking.agentUserId,

        booking.agentName,

        readAt,

        at,
      ),
    )
  })
}

/**
 * The audit trail for the events the demo actually contains.
 *
 * One row per booking, per cancellation, and per money exception, plus a paid
 * entry for a slice of the receipts, all backdated to the event's own day. The
 * action strings are the ones the application writes, so the audit page's module
 * filter sorts them into booking, payment, cancellation, refund and transfer
 * rather than dumping them in "other".
 */

function seedAudit(demo: Demo): void {
  // A staff actor's own mailbox, the way `writeAudit` records it. The owner's

  // login is not a demo handle, so nothing is invented for it.

  const agentEmail = (userId: string): string | null => {
    const handle = demo.userHandles.get(userId)

    return handle ? demoEmail(demo, handle) : null
  }

  for (const booking of demo.bookings) {
    audit(
      demo,

      booking.agentUserId,

      agentEmail(booking.agentUserId),

      "project.booking.created",

      "booking",

      booking.id,

      {
        reference: booking.reference,
        unitCode: booking.unitCode,
        amount: booking.amount,
      },

      booking.date,
    )
  }

  for (const booking of demo.bookings.filter(
    (row) => row.status === "cancelled",
  )) {
    audit(
      demo,

      booking.agentUserId,

      agentEmail(booking.agentUserId),

      "project.booking.cancelled",

      "booking",

      booking.id,

      {
        reference: booking.reference,
        reason: "Buyer withdrew before possession",
      },

      dayMinus(demo.today, 20),
    )
  }

  for (const booking of demo.bookings
    .filter((row) => row.status === "confirmed")
    .slice(0, 24)) {
    audit(
      demo,

      demo.roleUsers.get("accounts_officer")?.[0] ?? demo.actorUserId,

      null,

      "payment.recorded",

      "payment",

      booking.id,

      { reference: booking.reference, method: "bank" },

      dayMinus(booking.date, 2),
    )
  }

  const admin = demo.roleUsers.get("tenant_admin")?.[0] ?? demo.actorUserId

  audit(
    demo,
    admin,
    null,
    "refund.paid",
    "refund",
    null,
    { credit: "AT-CRN-1001" },
    dayMinus(demo.today, 6),
  )

  audit(
    demo,
    admin,
    null,
    "transfer.approved",
    "transfer",
    null,
    { fee: 25_000 },
    dayMinus(demo.today, 4),
  )

  audit(
    demo,
    admin,
    null,
    "late_fee.waived",
    "late_fee",
    null,
    { waivers: 2 },
    dayMinus(demo.today, 3),
  )

  audit(
    demo,

    admin,

    null,

    "documents.created",

    "document",

    null,

    { uploaded: demo.counts.get("documents") ?? 0 },

    dayMinus(demo.today, 8),
  )

  audit(
    demo,

    admin,

    null,

    "tickets.replied",

    "ticket",

    null,

    { open: 2, inProgress: 3 },

    dayMinus(demo.today, 1),
  )

  audit(
    demo,

    demo.actorUserId,

    null,

    "expense.marked_paid",

    "expense",

    null,

    { paid: demo.counts.get("expenses") ?? 0 },

    dayMinus(demo.today, 2),
  )
}

function audit(
  demo: Demo,

  actorUserId: string,

  actorEmail: string | null,

  action: string,

  targetType: string,

  targetId: string | null,

  detail: Record<string, unknown>,

  occurredDay: string,
): void {
  const id = seqId(demo, "aud")

  const at = stamp(demo.today, daysBack(demo, occurredDay), 11)

  write(demo, "audit_log", id, () =>
    run(
      `INSERT INTO audit_log (
         id, tenant_id, actor_user_id, actor_email, action, target_type, target_id,
         detail, ip_address, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      id,

      demo.tenantId,

      actorUserId,

      actorEmail,

      action,

      targetType,

      targetId,

      JSON.stringify(detail),

      "10.20.0.11",

      at,
    ),
  )
}
