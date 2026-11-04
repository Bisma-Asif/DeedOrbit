/**
 * The document verification queue.
 *
 * One screen for the reviewing role: everything filed but not yet certified,
 * across both stored review states, with the counts on cards computed from the
 * same two fetches so no number is decoration. Rows open
 * `DocumentReviewDialog`, the side-by-side decide screen; the table itself stays
 * honest — the CNIC never appears here (it lives on the review and reveal
 * surfaces), and an expiry in the past is muted red rather than a guess.
 *
 * Access is two-gated the way the API is: the nav entry rides the `documents`
 * module (`viewModule`), but the queue endpoint itself answers only to
 * `documents.verify`, so a reader without the verify grant gets an explicit
 * refusal instead of an empty table that looks like "nothing to do".
 */

import { useMemo, useState } from "react"

import { ExternalLink, Inbox, ShieldCheck } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { DataTable, type DataTableColumn } from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { StatCard } from "@/components/stat-card"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { navigate } from "@/lib/router"

import { formatDate, formatRelative, orDash } from "@/lib/format"

import { useAsyncResource } from "@/lib/use-async-resource"

import { useSession } from "@/lib/session-context"

import {
  documentVerificationApi,
  type QueueDocument,
  type VerificationQueueParams,
} from "@/lib/document-verification-api"

import { DocumentReviewDialog } from "./document-review-dialog"

import type {
  DocumentChecklistState,
  DocumentOcrStatus,
} from "@shared/document-verification"

import {
  DOCUMENT_CHECKLIST_STATE_LABELS,
  DOCUMENT_CHECKLIST_STATE_TONES,
} from "@shared/document-verification"

/** A row plus the state the queue derives from the stored columns. */

interface QueueRow {
  document: QueueDocument

  state: DocumentChecklistState
}

function toRow(document: QueueDocument, status: string): QueueRow {
  const expired =
    document.expiresAt !== null &&
    document.expiresAt.slice(0, 10) < new Date().toISOString().slice(0, 10)

  const state: DocumentChecklistState = expired
    ? "expired"
    : status === "under_review"
      ? "under_review"
      : "uploaded"

  return { document, state }
}

const ALL_TYPES = "all"

export function VerificationQueuePage() {
  const { can } = useSession()

  const canVerify = can("documents", "verify")

  // Both stored states in one fetch pair: the cards and the type filter then

  // describe the real workload, and switching status is a local no-refetch.

  const resource = useAsyncResource(async (signal) => {
    const params: VerificationQueueParams[] = [
      { status: "under_review", limit: 200 },

      { status: "unverified", limit: 200 },
    ]

    const [underReview, unverified] = await Promise.all(
      params.map((query) => documentVerificationApi.queue(query, signal)),
    )

    return {
      underReview: underReview.items.map((item) => toRow(item, "under_review")),

      unverified: unverified.items.map((item) => toRow(item, "unverified")),
    }
  }, canVerify)

  const [status, setStatus] = useState<"under_review" | "unverified">(
    "under_review",
  )

  const [typeKey, setTypeKey] = useState<string>(ALL_TYPES)

  const [reviewId, setReviewId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const loaded =
      status === "under_review"
        ? (resource.data?.underReview ?? [])
        : (resource.data?.unverified ?? [])

    return typeKey === ALL_TYPES
      ? loaded
      : loaded.filter((row) => row.document.checklistKey === typeKey)
  }, [resource.data, status, typeKey])

  const typeOptions = useMemo(() => {
    const keys = new Set<string>()

    for (const row of resource.data?.underReview ?? []) {
      if (row.document.checklistKey) keys.add(row.document.checklistKey)
    }

    for (const row of resource.data?.unverified ?? []) {
      if (row.document.checklistKey) keys.add(row.document.checklistKey)
    }

    return [...keys].sort()
  }, [resource.data])

  if (!canVerify) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Document verification"
          description="The review queue for customer papers — certify, reject, or ask for a fresh copy."
        />

        <EmptyState
          icon={ShieldCheck}
          title="Verification needs a verify grant"
          description="Your role can read documents but cannot certify them. The queue answers only to the document-verify permission."
        />
      </div>
    )
  }

  const underReviewCount = resource.data?.underReview.length ?? 0

  const unverifiedCount = resource.data?.unverified.length ?? 0

  const portalCount = [
    ...(resource.data?.underReview ?? []),

    ...(resource.data?.unverified ?? []),
  ].filter((row) => row.document.source === "portal").length

  const expiringCount = [
    ...(resource.data?.underReview ?? []),

    ...(resource.data?.unverified ?? []),
  ].filter((row) => row.state === "expired").length

  const columns: DataTableColumn<QueueRow>[] = [
    {
      key: "title",

      header: "Document",

      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground">
            {row.document.title}
          </p>

          <p className="truncate text-[11.5px] text-muted-foreground">
            {orDash(row.document.checklistKey)} · {row.document.filename}
          </p>
        </div>
      ),

      sortValue: (row) => row.document.title.toLowerCase(),
    },

    {
      key: "customer",

      header: "Customer",

      cell: (row) => (
        <div className="min-w-0">
          <button
            type="button"
            className="truncate text-[13px] text-foreground hover:underline"
            title="Open the customer record"
            onClick={() => navigate(`/customers/${row.document.customerId}`)}
          >
            {orDash(row.document.customerName)}
          </button>

          <p className="text-[11px] text-muted-foreground">
            {row.document.customerId}
          </p>
        </div>
      ),

      sortValue: (row) => (row.document.customerName ?? "").toLowerCase(),
    },

    {
      key: "state",

      header: "State",

      cell: (row) => (
        <Badge variant={DOCUMENT_CHECKLIST_STATE_TONES[row.state]}>
          {DOCUMENT_CHECKLIST_STATE_LABELS[row.state]}
        </Badge>
      ),

      sortValue: (row) => row.state,
    },

    {
      key: "source",

      header: "Source",

      cell: (row) => (
        <span className="text-[12px] text-muted-foreground">
          {row.document.source === "portal"
            ? "Customer portal"
            : "Staff upload"}
        </span>
      ),

      sortValue: (row) => row.document.source,
    },

    {
      key: "uploaded",

      header: "Uploaded",

      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] text-foreground">
            {row.document.uploadedByName}
          </p>

          <p className="text-[11px] text-muted-foreground">
            {formatRelative(row.document.createdAt)} ·{" "}
            {formatDate(row.document.createdAt)}
          </p>
        </div>
      ),

      sortValue: (row) => row.document.createdAt,
    },

    {
      key: "expiry",

      header: "Validity ends",

      cell: (row) =>
        row.document.expiresAt ? (
          <span
            className={
              row.state === "expired"
                ? "text-[12px] text-danger tabular-nums"
                : "text-[12px] tabular-nums"
            }
          >
            {formatDate(row.document.expiresAt)}
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground">—</span>
        ),

      sortValue: (row) => row.document.expiresAt ?? "9999-12-31",
    },

    {
      key: "ocr",

      header: "Extraction",

      cell: (row) => (
        <span className="text-[12px] text-muted-foreground">
          {ocrLabel(row.document.ocrStatus)}
        </span>
      ),

      sortValue: (row) => row.document.ocrStatus,
    },

    {
      key: "actions",

      header: "",

      align: "right",

      cell: (row) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()

            setReviewId(row.document.id)
          }}
        >
          <ShieldCheck size={13} />
          Review
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Document verification"
        description="Everything filed but not yet certified. Open a row to compare the paper against the profile, then verify, reject, or ask for a fresh copy."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              navigate(`/customers?tab=documents&reason=verification`)
            }
          >
            <ExternalLink size={13} />
            Customer records
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Under review"
          value={String(underReviewCount)}
          hint="Awaiting a verifier's decision."
        />

        <StatCard
          label="Not yet reviewed"
          value={String(unverifiedCount)}
          hint="Filed without entering the review stage."
        />

        <StatCard
          label="From the portal"
          value={String(portalCount)}
          hint="Uploaded by the customer, not staff."
        />

        <StatCard
          label="Expired papers"
          value={String(expiringCount)}
          hint="Validity date already past."
        />
      </div>

      {resource.error ? (
        <Alert variant="danger">
          <AlertDescription>{resource.error}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable<QueueRow>
        columns={columns}
        rows={rows}
        rowKey={(row) => row.document.id}
        getRowSearchText={(row) =>
          [
            row.document.title,

            row.document.customerName ?? "",

            row.document.checklistKey ?? "",

            row.document.uploadedByName,
          ].join(" ")
        }
        initialSort={{ key: "uploaded", direction: "desc" }}
        loading={resource.loading && !resource.data}
        onRowClick={(row) => setReviewId(row.document.id)}
        filterBar={
          <div className="flex items-center gap-2">
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as "under_review" | "unverified")
              }
            >
              <SelectTrigger size="sm" aria-label="Review state">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="under_review">Under review</SelectItem>
                <SelectItem value="unverified">Unverified</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeKey} onValueChange={setTypeKey}>
              <SelectTrigger size="sm" aria-label="Document type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES}>All types</SelectItem>

                {typeOptions.map((key) => (
                  <SelectItem key={key} value={key}>
                    {key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        emptyState={
          <EmptyState
            icon={Inbox}
            title="Nothing waiting"
            description={
              typeKey === ALL_TYPES
                ? "No documents are sitting in this review state right now."
                : "No documents of this type are in this review state right now."
            }
          />
        }
      />

      <DocumentReviewDialog
        open={reviewId !== null}
        documentId={reviewId}
        onOpenChange={(open) => {
          if (!open) setReviewId(null)
        }}
        onChanged={() => void resource.reload()}
      />
    </div>
  )
}

function ocrLabel(status: string): string {
  const known: Record<DocumentOcrStatus, string> = {
    none: "Manual read",

    suggested: "Suggestions pending confirmation",

    confirmed: "Fields confirmed",

    failed: "Extraction failed",
  }

  return known[(status as DocumentOcrStatus)] ?? status
}
