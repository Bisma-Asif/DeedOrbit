import type {
  CustomerEditEvent,
  CustomerEntryInput,
} from "@shared/customer-entry"
import { emptyCustomerInput } from "@shared/customer-entry"

import type { LeadStatus } from "@shared/leads"

import { api } from "./api"

export interface Lead {
  id: string

  name: string

  phone: string

  email: string | null

  source: string

  campaign: string | null

  projectInterest: string | null

  budgetMin: number | null

  budgetMax: number | null

  assignedAgentId: string | null

  assignedAgentName: string | null

  status: LeadStatus

  followUpDate: string | null

  lostReason: string | null

  customerId: string | null

  createdAt: string

  updatedAt: string
}

export interface LeadStage {
  id: string
  key: string
  label: string
  tone: "neutral" | "success" | "warning" | "info" | "danger"
  sortOrder: number
  isBuiltin: boolean
}

export interface LeadActivity {
  id: string
  type: string
  body: string
  fromStage: string | null
  toStage: string | null
  actorUserId: string | null
  actorName: string
  createdAt: string
}

export interface LeadDetailResponse {
  lead: Lead
  activities: LeadActivity[]
  canEdit: boolean
  canConvert: boolean
}

export interface LeadStageResponse {
  stages: LeadStage[]
}

export interface ConvertedCustomer {
  id: string
  name: string
  phone: string
  email: string | null
  sourceLeadId: string
  createdAt: string
}

/**
 * One customer, exactly as `/api/customers` returns it.
 *
 * The name has outlived its first meaning: the same shape serves the list and the detail
 * page, because the route reads the same columns for both and a second, narrower shape
 * would be a second set of rules about what a table may show. Two of its fields carry the
 * rules rather than data: `cnic` is present only for a caller who may edit, and
 * `missingBookingFields` is the shared checklist already reduced to labels, so a list row
 * and a report line cannot disagree about what a file still needs.
 */

export interface CustomerListItem {
  id: string
  name: string
  fatherHusbandName: string | null
  /** The whole number, and only for a caller who holds `customers.edit`. */
  cnic: string | null
  /** What a table may print for anyone who can read the record at all. */
  cnicMasked: string | null
  dateOfBirth: string | null
  gender: string | null
  phone: string
  whatsapp: string | null
  email: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  stateRegion: string | null
  postalCode: string | null
  country: string | null
  permanentAddressLine1: string | null
  permanentAddressLine2: string | null
  permanentCity: string | null
  permanentStateRegion: string | null
  permanentPostalCode: string | null
  permanentCountry: string | null
  customerType: string | null
  occupation: string | null
  notes: string | null
  idDocumentType: string | null
  idDocumentNumber: string | null
  idIssuingAuthority: string | null
  idIssueDate: string | null
  idExpiryDate: string | null
  nomineeName: string | null
  nomineeRelationship: string | null
  nomineePhone: string | null
  nomineeEmail: string | null
  nextOfKinName: string | null
  nextOfKinRelationship: string | null
  nextOfKinPhone: string | null
  nextOfKinEmail: string | null
  source: string | null
  projectInterest: string | null
  sourceLeadId: string | null
  /** Who first put this person in the workspace, as the desk wrote it. */
  createdByName: string | null
  /** Labels, not keys: this is what to go and collect. */
  missingBookingFields: string[]
  createdAt: string
  updatedAt: string
}

export interface CustomerListResponse {
  customers: CustomerListItem[]
  canCreate: boolean
  canEdit: boolean
}

export interface CustomerDetailResponse {
  customer: CustomerListItem
  canEdit: boolean
}

/**
 * The form's own shape: every customer-entry field as text, empty where nobody typed one.
 *
 * The keys come from the shared field list rather than from a list kept here, so a field
 * the API validates but the form cannot reach — or one the form offers and the route
 * throws away — is a compile error instead of a silent gap.
 */

export type CustomerInput = CustomerEntryInput

/** Another record already carrying the same CNIC or phone number. */
export interface CustomerDuplicate {
  id: string
  name: string
  cnicMasked: string | null
  phone: string
  /** Why it matched, in the words the officer can act on. */
  reason: string
}

/**
 * What a save answered.
 *
 * A duplicate never fails the save, so the warning has to travel with the result instead of
 * as an error the form would have to swallow. `warnings` are the notes the route could not
 * refuse on but will not hide either — a buyer who is fifteen today, say.
 */

export interface CustomerSaveResult {
  customer: CustomerListItem
  duplicates: CustomerDuplicate[]
  warnings: string[]
  /** Only a PATCH says how many fields it wrote; a first entry has nothing to compare to. */
  changedCount?: number
}

export interface CustomerEditHistoryResponse {
  events: CustomerEditEvent[]
}

/**
 * A saved record read back as form values.
 *
 * Every absent column becomes an empty string rather than a guess, because the form's own
 * "nothing typed" and the record's "nobody typed this" are the same fact and the save has
 * to send it on unchanged. `cnic` is the one field where a null means something else — "not
 * yours to read" — and a reader without `customers.edit` cannot reach the save either, so
 * the blank field is never a path to writing over a number the workspace holds.
 */

export function customerInputFromCustomer(
  customer: CustomerListItem,
): CustomerInput {
  const values = emptyCustomerInput()

  const text = (value: string | null): string => value ?? ""

  values.fullName = customer.name
  values.fatherHusbandName = text(customer.fatherHusbandName)
  values.cnic = text(customer.cnic)
  values.dateOfBirth = text(customer.dateOfBirth)
  values.gender = text(customer.gender)
  values.phone = customer.phone
  values.whatsapp = text(customer.whatsapp)
  values.email = text(customer.email)
  values.addressLine1 = text(customer.addressLine1)
  values.addressLine2 = text(customer.addressLine2)
  values.city = text(customer.city)
  values.stateRegion = text(customer.stateRegion)
  values.postalCode = text(customer.postalCode)
  values.country = text(customer.country)
  values.permanentAddressLine1 = text(customer.permanentAddressLine1)
  values.permanentAddressLine2 = text(customer.permanentAddressLine2)
  values.permanentCity = text(customer.permanentCity)
  values.permanentStateRegion = text(customer.permanentStateRegion)
  values.permanentPostalCode = text(customer.permanentPostalCode)
  values.permanentCountry = text(customer.permanentCountry)
  values.customerType = text(customer.customerType)
  values.occupation = text(customer.occupation)
  values.notes = text(customer.notes)
  values.idDocumentType = text(customer.idDocumentType)
  values.idDocumentNumber = text(customer.idDocumentNumber)
  values.idIssuingAuthority = text(customer.idIssuingAuthority)
  values.idIssueDate = text(customer.idIssueDate)
  values.idExpiryDate = text(customer.idExpiryDate)
  values.nomineeName = text(customer.nomineeName)
  values.nomineeRelationship = text(customer.nomineeRelationship)
  values.nomineePhone = text(customer.nomineePhone)
  values.nomineeEmail = text(customer.nomineeEmail)
  values.nextOfKinName = text(customer.nextOfKinName)
  values.nextOfKinRelationship = text(customer.nextOfKinRelationship)
  values.nextOfKinPhone = text(customer.nextOfKinPhone)
  values.nextOfKinEmail = text(customer.nextOfKinEmail)

  return values
}

export interface LeadAgent {
  id: string

  name: string

  role: string
}

export interface LeadListResponse {
  leads: Lead[]

  agents: LeadAgent[]

  sources: string[]

  stages: LeadStage[]

  totals: {
    total: number

    open: number

    qualified: number

    converted: number

    followUpsDue: number
  }

  canCreate: boolean

  canEdit: boolean

  canConvert: boolean
}

export interface LeadInput {
  name: string

  phone: string

  email: string

  source: string

  campaign: string

  projectInterest: string

  budgetMin: number | null

  budgetMax: number | null

  assignedAgentId: string

  status: LeadStatus

  followUpDate: string

  lostReason: string
}

export interface LeadStageInput {
  label?: string
  sortOrder?: number
}

interface LeadResponse {
  lead: Lead
}

export const leadsApi = {
  list: (signal?: AbortSignal) =>
    api.get<LeadListResponse>("/api/leads", signal),

  create: (input: LeadInput) => api.post<LeadResponse>("/api/leads", input),

  update: (id: string, input: LeadInput) =>
    api.patch<LeadResponse>(`/api/leads/${id}`, input),

  read: (id: string, signal?: AbortSignal) =>
    api.get<LeadDetailResponse>(`/api/leads/${id}`, signal),

  addNote: (id: string, note: string) =>
    api.post<{ ok: true }>(`/api/leads/${id}/activities`, { note }),

  createStage: (label: string) =>
    api.post<LeadStageResponse>("/api/leads/stages", { label }),

  updateStage: (id: string, input: LeadStageInput) =>
    api.patch<LeadStageResponse>(`/api/leads/stages/${id}`, input),

  deleteStage: (id: string) =>
    api.delete<LeadStageResponse>(`/api/leads/stages/${id}`),

  convert: (id: string) =>
    api.post<{ customer: ConvertedCustomer }>(`/api/leads/${id}/convert`),
}

export const customersApi = {
  list: (signal?: AbortSignal) =>
    api.get<CustomerListResponse>("/api/customers", signal),

  read: (id: string, signal?: AbortSignal) =>
    api.get<CustomerDetailResponse>(`/api/customers/${id}`, signal),

  /** The save lands and the answer says what else it noticed. */
  create: (input: CustomerInput) =>
    api.post<CustomerSaveResult>("/api/customers", input),

  update: (id: string, input: CustomerInput) =>
    api.patch<CustomerSaveResult>(`/api/customers/${id}`, input),

  /** Who typed what and when, newest first. Readable without `customers.edit`. */
  editHistory: (id: string, signal?: AbortSignal) =>
    api.get<CustomerEditHistoryResponse>(
      `/api/customers/${id}/edit-history`,
      signal,
    ),
}
