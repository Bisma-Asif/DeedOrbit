/**
 * Typed client for the projects endpoints.
 *
 * These live apart from `api.ts` for the same reason the organization ones do:
 * the projects module owns enough vocabulary that its contract is easier to
 * review on its own. The transport (`api.get`/`post`/`patch`) and `ApiError` are
 * shared, so a server-side validation failure still arrives as a field map and
 * lands next to the control that owns it.
 *
 * Every interface here mirrors `server/routes/projects.ts` exactly. The closed
 * sets are imported from `@shared/projects` rather than restated, so a status
 * added to the database without the UI knowing about it is a type error rather
 * than an unstyled badge at runtime.
 *
 * `plannedUnits` is the developer's stated plan, not a count of inventory rows,
 * and it is nullable at every layer — a dash, never a zero.
 */

import type {
  OwnershipType,
  ProjectStatus,
  ProjectType,
} from "@shared/projects"

import { api } from "./api"

export interface Project {
  id: string
  name: string
  code: string | null
  developer: string
  location: string
  status: ProjectStatus
  launchDate: string | null
  description: string | null
  projectType: ProjectType | null
  ownershipType: OwnershipType | null
  paymentTerms: string | null
  handoverDate: string | null
  plannedUnits: number | null
  createdAt: string
  updatedAt: string
}

/**
 * The four figures the list leads with. `plannedUnits` is null when no project
 * states one, which is why the tile shows a dash instead of 0 — a portfolio of
 * projects that have not been sized yet is not a portfolio of zero units.
 */
export interface ProjectTotals {
  total: number
  onSale: number
  launchingSoon: number
  plannedUnits: number | null
}

export interface ProjectList {
  projects: Project[]
  totals: ProjectTotals
  canCreate: boolean
  canEdit: boolean
}

export interface ProjectDetail {
  project: Project
  canEdit: boolean
}

/**
 * A partial save. Keys absent from the request are left untouched by the server,
 * which is what lets the Settings tab save one section without resending — or
 * clobbering — the fields it does not own.
 */
export interface ProjectInput {
  name?: string
  code?: string | null
  developer?: string
  location?: string
  status?: ProjectStatus
  launchDate?: string | null
  description?: string | null
  projectType?: ProjectType | null
  ownershipType?: OwnershipType | null
  paymentTerms?: string | null
  handoverDate?: string | null
  plannedUnits?: number | null
}

interface ProjectPayload {
  project: Project
}

export const projectsApi = {
  list: (signal?: AbortSignal) => api.get<ProjectList>("/api/projects", signal),

  read: (id: string, signal?: AbortSignal) =>
    api.get<ProjectDetail>(`/api/projects/${id}`, signal),

  create: (input: ProjectInput) =>
    api.post<ProjectPayload>("/api/projects", input),

  update: (id: string, input: ProjectInput) =>
    api.patch<ProjectPayload>(`/api/projects/${id}`, input),
}
