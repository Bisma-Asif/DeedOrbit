import { api } from "./api"

export interface SalesAgent {
  id: string

  name: string

  email: string

  phone: string | null

  jobTitle: string | null

  teamId: string | null

  teamName: string | null

  assignedLeads: number

  leadsAchieved: number

  leadsTarget: number | null

  bookingsClosed: number | null

  bookingsTarget: number | null

  collectionsMade: number | null

  collectionsTarget: number | null
}

export interface SalesTeam {
  id: string

  name: string

  managerUserId: string | null

  managerName: string | null

  memberCount: number
}

export interface SalesManagerOption {
  id: string

  name: string

  role: string
}

export interface SalesAgentListResponse {
  month: string
  currency: string

  agents: SalesAgent[]

  teams: SalesTeam[]

  managers: SalesManagerOption[]

  canManage: boolean

  canCreateTeam: boolean
}

export interface SalesTeamInput {
  name: string

  managerUserId: string
}

export interface SalesTeamInputResponse {
  teams: SalesTeam[]
}

export interface AgentTeamInput {
  teamId: string | null
}

export interface SalesTargetInput {
  month: string

  leadsTarget: number | null

  bookingsTarget: number | null

  collectionsTarget: number | null
}

export interface SalesTargetResponse {
  month: string

  targets: Omit<SalesTargetInput, "month">
}

export const salesAgentsApi = {
  list: (month: string, signal?: AbortSignal) =>
    api.get<SalesAgentListResponse>(
      `/api/sales-agents?month=${encodeURIComponent(month)}`,
      signal,
    ),

  createTeam: (input: SalesTeamInput) =>
    api.post<SalesTeamInputResponse>("/api/sales-agents/teams", input),

  updateTeam: (teamId: string, input: SalesTeamInput) =>
    api.patch<SalesTeamInputResponse>(
      `/api/sales-agents/teams/${teamId}`,
      input,
    ),

  assignTeam: (agentId: string, input: AgentTeamInput) =>
    api.put<{ ok: true }>(`/api/sales-agents/${agentId}/team`, input),

  saveTargets: (agentId: string, input: SalesTargetInput) =>
    api.put<SalesTargetResponse>(`/api/sales-agents/${agentId}/targets`, input),
}
