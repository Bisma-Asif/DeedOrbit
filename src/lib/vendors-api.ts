/**
 * Typed client for the vendors module.
 *
 * Mirrors `server/routes/vendors.ts`. A vendor is the profile; contracts,
 * invoices, payments, and the ledger hang off the vendor id. The ledger shape
 * matches the customer ledger exactly — signed amounts, running balance folded
 * at read — with the opposite reading: positive means we owe them more, negative
 * means money out.
 */

import type {
  Vendor,
  VendorContract,
  VendorContractStatus,
  VendorInvoice,
  VendorInvoiceStatus,
  VendorLedgerEntry,
  VendorLedgerKind,
  VendorStatus,
} from "@shared/vendors"

import { api } from "./api"

export interface VendorListResponse {
  vendors: Vendor[]

  currency: string

  canCreate: boolean

  canEdit: boolean
}

export interface VendorDetailResponse {
  vendor: Vendor

  canEdit: boolean

  canCreate: boolean
}

export interface VendorMutationResponse {
  vendor: Vendor
}

export interface VendorListFilters {
  search?: string

  status?: VendorStatus | ""
}

export interface VendorContractListResponse {
  contracts: VendorContract[]

  canEdit: boolean
}

export interface VendorContractMutationResponse {
  contract: VendorContract
}

export interface VendorInvoiceListResponse {
  invoices: VendorInvoice[]

  canEdit: boolean
}

export interface VendorInvoiceMutationResponse {
  invoice: VendorInvoice
}

export interface VendorLedgerResponse {
  entries: VendorLedgerEntry[]

  currency: string

  balance: number
}

export interface VendorInput {
  name: string

  contactName: string | null

  email: string | null

  phone: string | null

  taxId: string | null

  addressLine1: string | null

  addressLine2: string | null

  city: string | null

  countryCode: string | null

  notes: string | null

  status?: VendorStatus
}

export interface VendorContractInput {
  reference: string

  title: string

  value: number

  startDate: string | null

  endDate: string | null

  notes: string | null

  status?: VendorContractStatus
}

export interface VendorInvoiceInput {
  reference: string

  amount: number

  issuedAt: string

  dueAt: string | null

  contractId: string | null

  note: string | null
}

export interface VendorPaymentInput {
  invoiceId: string | null

  amount: number

  occurredAt: string

  note: string | null
}

export interface VendorPaymentResponse {
  ok: true
  vendorId: string
}

export interface VendorLedgerFilters {
  from?: string
  to?: string
  kind?: VendorLedgerKind | ""
}

function query(filters: VendorListFilters): string {
  const params = new URLSearchParams()

  if (filters.search) params.set("search", filters.search)

  if (filters.status) params.set("status", filters.status)

  const qs = params.toString()

  return qs ? `?${qs}` : ""
}

export const vendorsApi = {
  list: (filters: VendorListFilters = {}, signal?: AbortSignal) =>
    api.get<VendorListResponse>(`/api/vendors${query(filters)}`, signal),

  read: (id: string, signal?: AbortSignal) =>
    api.get<VendorDetailResponse>(`/api/vendors/${id}`, signal),

  create: (input: VendorInput) =>
    api.post<VendorMutationResponse>("/api/vendors", input),

  update: (id: string, input: VendorInput) =>
    api.patch<VendorMutationResponse>(`/api/vendors/${id}`, input),

  listContracts: (vendorId: string, signal?: AbortSignal) =>
    api.get<VendorContractListResponse>(
      `/api/vendors/${vendorId}/contracts`,

      signal,
    ),

  createContract: (vendorId: string, input: VendorContractInput) =>
    api.post<VendorContractMutationResponse>(
      `/api/vendors/${vendorId}/contracts`,

      input,
    ),

  updateContract: (
    vendorId: string,

    contractId: string,

    input: Partial<VendorContractInput>,
  ) =>
    api.patch<VendorContractMutationResponse>(
      `/api/vendors/${vendorId}/contracts/${contractId}`,

      input,
    ),

  listInvoices: (
    vendorId: string,

    status: VendorInvoiceStatus | "" = "",

    signal?: AbortSignal,
  ) =>
    api.get<VendorInvoiceListResponse>(
      `/api/vendors/${vendorId}/invoices${status ? `?status=${status}` : ""}`,

      signal,
    ),

  createInvoice: (vendorId: string, input: VendorInvoiceInput) =>
    api.post<VendorInvoiceMutationResponse>(
      `/api/vendors/${vendorId}/invoices`,

      input,
    ),

  voidInvoice: (vendorId: string, invoiceId: string) =>
    api.post<VendorInvoiceMutationResponse>(
      `/api/vendors/${vendorId}/invoices/${invoiceId}/void`,
    ),

  recordPayment: (vendorId: string, input: VendorPaymentInput) =>
    api.post<VendorPaymentResponse>(
      `/api/vendors/${vendorId}/payments`,

      input,
    ),

  ledger: (
    vendorId: string,

    filters: VendorLedgerFilters = {},

    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams()

    if (filters.from) params.set("from", filters.from)

    if (filters.to) params.set("to", filters.to)

    if (filters.kind) params.set("kind", filters.kind)

    const qs = params.toString()

    return api.get<VendorLedgerResponse>(
      `/api/vendors/${vendorId}/ledger${qs ? `?${qs}` : ""}`,

      signal,
    )
  },
}
