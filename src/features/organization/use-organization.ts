import { organizationApi } from "@/lib/organization-api"

import type {
  Branch,
  NumberingSettings,
  OrganizationSettings,
} from "@/lib/organization-api"

import { useAsyncResource } from "@/lib/use-async-resource"

/**
 * Data hooks for the organization module.
 *
 * Each hook is gated on the matching view grant, so a role that cannot read
 * organization settings never fires the request. The server re-checks
 * everything regardless; this only avoids guaranteed-403 noise in the console.
 */

export function useOrganizationSettings(enabled = true) {
  return useAsyncResource<{ settings: OrganizationSettings }>(
    (signal) => organizationApi.read(signal),
    enabled,
  )
}

interface BranchList {
  branches: Branch[]
  canEdit: boolean
}

export function useBranches(enabled = true) {
  return useAsyncResource<BranchList>(
    (signal) => organizationApi.listBranches(signal),
    enabled,
  )
}

export function useNumbering(enabled = true) {
  return useAsyncResource<NumberingSettings>(
    (signal) => organizationApi.readNumbering(signal),
    enabled,
  )
}
