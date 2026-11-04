/**
 * Typed client for the construction module.
 *
 * Mirrors `server/routes/construction.ts`. A phase's actuals are never sent or
 * stored here - the server derives them from tagged expense/invoice rows and
 * returns them grouped by currency, so the client only reads. Progress carries
 * the mode it was decided in (`progressMode`) so the screen can label it rather
 * than blend a manager's number with a task rollup.
 */

import type {
  ContractorStatus,
  ConstructionContractorView,
  ConstructionPhaseDetail,
  ConstructionPhaseView,
  ConstructionTaskView,
  ContractorTrade,
  PhaseStatus,
  TaskStatus,
} from "@shared/construction"

import { api } from "./api"

export interface ContractorListResult {
  contractors: ConstructionContractorView[]

  canManage: boolean
}

export interface PhaseListResult {
  phases: ConstructionPhaseView[]

  statusLabels: Record<PhaseStatus, string>

  canCreate: boolean

  canEdit: boolean
}

export interface ContractorMutation {
  contractor: ConstructionContractorView
}

export interface PhaseMutation {
  phase: ConstructionPhaseView
}

export interface TaskMutation {
  task: ConstructionTaskView
}

export interface ContractorInput {
  name: string

  trade: ContractorTrade

  vendorId?: string | null

  contactName?: string | null

  email?: string | null

  phone?: string | null

  notes?: string | null
}

export interface ContractorUpdateInput extends Partial<ContractorInput> {
  status?: ContractorStatus
}

export interface PhaseInput {
  projectId: string

  name: string

  sequence?: number

  plannedStart?: string | null

  plannedEnd?: string | null

  budgetAmount?: number | null

  budgetCurrency?: string | null
}

export interface PhaseUpdateInput {
  name?: string

  status?: PhaseStatus

  plannedStart?: string | null

  plannedEnd?: string | null

  budgetAmount?: number | null

  budgetCurrency?: string | null

  manualProgress?: number | null
}

export interface TaskInput {
  name: string

  description?: string | null

  sequence?: number

  milestone?: boolean

  plannedStart?: string | null

  plannedEnd?: string | null

  contractorId?: string | null

  budgetAmount?: number | null
}

export interface TaskUpdateInput {
  name?: string

  description?: string | null

  status?: TaskStatus

  progress?: number

  milestone?: boolean

  contractorId?: string | null

  assigneeUserId?: string | null

  plannedStart?: string | null

  plannedEnd?: string | null

  actualStart?: string | null

  actualEnd?: string | null

  budgetAmount?: number | null
}

export interface ProgressLogInput {
  percent: number

  note?: string | null

  taskId?: string | null
}

function phaseQuery(projectId?: string): string {
  return projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
}

export const constructionApi = {
  listContractors: (signal?: AbortSignal) =>
    api.get<ContractorListResult>("/api/construction/contractors", signal),

  createContractor: (input: ContractorInput) =>
    api.post<ContractorMutation>("/api/construction/contractors", input),

  updateContractor: (id: string, input: ContractorUpdateInput) =>
    api.patch<ContractorMutation>(
      `/api/construction/contractors/${id}`,

      input,
    ),

  listPhases: (projectId?: string, signal?: AbortSignal) =>
    api.get<PhaseListResult>(
      `/api/construction/phases${phaseQuery(projectId)}`,

      signal,
    ),

  createPhase: (input: PhaseInput) =>
    api.post<PhaseMutation>("/api/construction/phases", input),

  getPhase: (id: string, signal?: AbortSignal) =>
    api.get<ConstructionPhaseDetail>(`/api/construction/phases/${id}`, signal),

  updatePhase: (id: string, input: PhaseUpdateInput) =>
    api.patch<PhaseMutation>(`/api/construction/phases/${id}`, input),

  deletePhase: (id: string) =>
    api.delete<{ ok: true }>(`/api/construction/phases/${id}`),

  logProgress: (id: string, input: ProgressLogInput) =>
    api.post<PhaseMutation>(
      `/api/construction/phases/${id}/log-progress`,
      input,
    ),

  createTask: (phaseId: string, input: TaskInput) =>
    api.post<TaskMutation>(`/api/construction/phases/${phaseId}/tasks`, input),

  updateTask: (taskId: string, input: TaskUpdateInput) =>
    api.patch<TaskMutation>(`/api/construction/tasks/${taskId}`, input),

  deleteTask: (taskId: string) =>
    api.delete<{ ok: true }>(`/api/construction/tasks/${taskId}`),
}
