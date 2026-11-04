import { rolesApi, usersApi } from "@/lib/api"

import type { BranchOption, RoleSummary, TenantUser } from "@/lib/api"

import { useAsyncResource } from "@/lib/use-async-resource"

/**
 * Members, plus the office catalogue that the branch filter and the scope editor
 * both need. The server sends branches alongside the member list rather than
 * behind `/api/settings/branches`, because a member administrator may not hold
 * `settings.view` and the filter still has to work for them.
 */
export function useTenantUsers(enabled = true) {
  const resource = useAsyncResource<{
    users: TenantUser[]
    roleCounts: Record<string, number>
    branches: BranchOption[]
  }>((signal) => usersApi.list(signal), enabled)

  return {
    ...resource,
    users: resource.data?.users ?? [],
    branches: resource.data?.branches ?? [],
  }
}

interface RolesPayload {
  roles: RoleSummary[]
  myRoleId: string
}

export function useRoles(enabled = true) {
  const resource = useAsyncResource<RolesPayload>(
    (signal) => rolesApi.list(signal),
    enabled,
  )

  return { ...resource, roles: resource.data?.roles ?? [] }
}
