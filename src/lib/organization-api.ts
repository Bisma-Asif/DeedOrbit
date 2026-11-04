/**
 * Typed client for the organization settings endpoints.
 *
 * These live apart from `api.ts` because the organization module owns a
 * sizeable amount of vocabulary, and keeping it in one file makes the shape of
 * the module reviewable on its own. The transport (`api.get`/`post`/...) and
 * `ApiError` are shared, so field-level server validation still arrives the
 * same way it does for the other modules.
 *
 * Every response mirrors `server/routes/organization.ts` exactly. Where the
 * server returns `null` for a column that has never been set, the field is
 * typed `| null` rather than defaulted to `""` so the UI can distinguish
 * "unset" from "set to empty" and must not invent a value.
 */

import type { NumberKind } from "@shared/organization"

import { api } from "./api"

export interface OrganizationLogo {
  mime: string
  dataUrl: string
  updatedAt: string | null
}

export interface OrganizationSettings {
  id: string
  name: string
  legalName: string | null
  slug: string
  status: string
  plan: string
  logoInitials: string | null
  currency: string
  timezone: string
  registrationNumber: string | null
  taxId: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  stateRegion: string | null
  postalCode: string | null
  countryCode: string | null
  phone: string | null
  collectionsEmail: string | null
  fiscalYearStartMonth: number
  workingDays: number[]
  /**
   * Whether the customer form may offer a "scan from document" control. Off unless an
   * admin turns it on, and no capture is wired even then — the control says so.
   */
  ocrCaptureEnabled: boolean
  logo: OrganizationLogo | null
  createdAt: string
  updatedAt: string
  userCount: number
  activeUsers: number
}

/**
 * A partial profile save. Keys absent from the request are left untouched by
 * the server, which is what lets one section save without clobbering a
 * concurrent edit to another.
 */
export interface OrganizationProfileInput {
  name?: string
  legalName?: string | null
  registrationNumber?: string | null
  taxId?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  stateRegion?: string | null
  postalCode?: string | null
  countryCode?: string | null
  phone?: string | null
  collectionsEmail?: string | null
  fiscalYearStartMonth?: number
  currency?: string
  timezone?: string
  workingDays?: number[]
  ocrCaptureEnabled?: boolean
}

export interface Branch {
  id: string
  name: string
  code: string | null
  isHeadquarters: boolean
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  stateRegion: string | null
  postalCode: string | null
  countryCode: string | null
  phone: string | null
  email: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export interface BranchInput {
  name?: string
  code?: string | null
  isHeadquarters?: boolean
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  stateRegion?: string | null
  postalCode?: string | null
  countryCode?: string | null
  phone?: string | null
  email?: string | null
  status?: string
}

export interface NumberFormat {
  kind: NumberKind
  label: string
  prefix: string
  padding: number
  nextValue: number
  resetYearly: boolean
  updatedAt: string | null
  /** The number the next document will carry, with no counter movement. */
  preview: string
}

export interface NumberFormatInput {
  kind: NumberKind
  prefix: string
  padding: number
  resetYearly: boolean
}

export interface NumberingSettings {
  formats: NumberFormat[]
  fiscalYear: number
  fiscalYearStartsIn: number
  canEdit: boolean
}

interface SettingsPayload {
  settings: OrganizationSettings
}

interface BranchPayload {
  branch: Branch
}

interface BranchListPayload {
  branches: Branch[]
  canEdit: boolean
}

interface ArchiveResult {
  ok: true
  id: string
}

interface IssuedNumber {
  kind: NumberKind
  number: string
  reset: boolean
}

export const organizationApi = {
  read: (signal?: AbortSignal) =>
    api.get<SettingsPayload>("/api/settings/organization", signal),

  updateProfile: (input: OrganizationProfileInput) =>
    api.patch<SettingsPayload>("/api/settings/organization", input),

  uploadLogo: (logoDataUrl: string) =>
    api.put<SettingsPayload>("/api/settings/organization/logo", {
      logoDataUrl,
    }),

  removeLogo: () =>
    api.delete<SettingsPayload>("/api/settings/organization/logo"),

  listBranches: (signal?: AbortSignal) =>
    api.get<BranchListPayload>("/api/settings/branches", signal),

  readBranch: (id: string) =>
    api.get<BranchPayload>(`/api/settings/branches/${id}`),

  createBranch: (input: BranchInput) =>
    api.post<BranchPayload>("/api/settings/branches", input),

  updateBranch: (id: string, input: BranchInput) =>
    api.patch<BranchPayload>(`/api/settings/branches/${id}`, input),

  archiveBranch: (id: string) =>
    api.delete<ArchiveResult>(`/api/settings/branches/${id}`),

  readNumbering: (signal?: AbortSignal) =>
    api.get<NumberingSettings>("/api/settings/numbering", signal),

  updateNumbering: (formats: NumberFormatInput[], resetCounters = false) =>
    api.put<NumberingSettings>("/api/settings/numbering", {
      formats,
      resetCounters,
    }),

  issueNumber: (kind: NumberKind) =>
    api.post<IssuedNumber>(`/api/settings/numbering/${kind}/next`),
}
