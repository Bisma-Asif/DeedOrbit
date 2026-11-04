import { useState } from "react"

import { SlidersHorizontal } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { EmptyState } from "@/components/empty-state"

import { PageHeader } from "@/components/page-header"

import { AccessControl } from "@/features/users/access-control"

import { OrganizationPanel } from "@/features/organization/organization-panel"

import { ApprovalPoliciesPanel } from "@/features/approvals/approval-policies-panel"

import { LateFeeRulesPanel } from "@/features/settings/late-fee-rules-panel"

import { CancellationRulesPanel } from "@/features/settings/cancellation-rules-panel"

import { DocumentVerificationPanel } from "@/features/settings/document-verification-panel"

import { IdentityProviderPanel } from "@/features/settings/identity-provider-panel"

import { InventorySetupPanel } from "@/features/settings/inventory-setup-panel"

import { CollectionTargetsPanel } from "@/features/settings/collection-targets-panel"

import { ChartOfAccountsPanel } from "@/features/settings/chart-of-accounts-panel"

import { JournalExportPanel } from "@/features/settings/journal-export-panel"

import { CommunicationsPanel } from "@/features/settings/communications-panel"

import { IntegrationsPanel } from "@/features/settings/integrations-panel"

import { SampleDataPanel } from "@/features/settings/sample-data-panel"

import type { Tenant } from "@/lib/workspace"

import { readQueryParam } from "@/lib/router"

/** Every tab the screen owns; a deep link may only name one of these. */
const SETTINGS_TABS = [
  "organisation",
  "offices",
  "numbering",
  "inventory",
  "approvals",
  "late-fees",
  "cancellation",
  "verification",
  "identity",
  "targets",
  "chart-of-accounts",
  "journal",
  "communications",
  "integrations",
  "sample",
  "access",
  "preferences",
] as const

/**
 * Settings.
 *
 * Every tab here is backed by the server. The Preferences tab used to hold four
 * switches and two selects that lived only in component state, so they read as
 * configuration while changing nothing and resetting on every reload. Rather
 * than ship controls that lie, the tab says plainly that there is nothing stored
 * to configure and points at what this deployment does persist.
 */
export function SettingsPage({ tenant }: { tenant: Tenant }) {
  // Dashboard checklist steps arrive as /settings?tab=access; an unknown name
  // falls back to the profile tab rather than rendering an empty panel.
  const [tab, setTab] = useState(() => {
    const requested = readQueryParam("tab")

    return requested && (SETTINGS_TABS as readonly string[]).includes(requested)
      ? requested
      : "organisation"
  })

  return (
    <div className="flex flex-col gap-4">
      {" "}
      <PageHeader
        scope={<span>{tenant.name}</span>}
        title="Settings"
        description="Organisation profile, offices, document numbering, and workspace access control."
      />{" "}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        {" "}
        {/*
          One tab row for the whole screen. The organization sections used to sit
          behind a second, nested tab bar of identical styling, which read as a
          rendering fault rather than as navigation.
        */}
        <TabsList>
          {" "}
          <TabsTrigger value="organisation">Organisation</TabsTrigger>{" "}
          <TabsTrigger value="offices">Offices</TabsTrigger>{" "}
          <TabsTrigger value="numbering">Numbering</TabsTrigger>{" "}
          <TabsTrigger value="inventory">Inventory setup</TabsTrigger>{" "}
          <TabsTrigger value="approvals">Approvals</TabsTrigger>{" "}
          <TabsTrigger value="late-fees">Late fees</TabsTrigger>{" "}
          <TabsTrigger value="cancellation">Cancellation</TabsTrigger>{" "}
          <TabsTrigger value="verification">Documents</TabsTrigger>{" "}
          <TabsTrigger value="identity">Identity provider</TabsTrigger>{" "}
          <TabsTrigger value="targets">Targets</TabsTrigger>{" "}
          <TabsTrigger value="chart-of-accounts">Chart of accounts</TabsTrigger>{" "}
          <TabsTrigger value="journal">Journal</TabsTrigger>{" "}
          <TabsTrigger value="communications">Communications</TabsTrigger>{" "}
          <TabsTrigger value="integrations">Integrations</TabsTrigger>{" "}
          <TabsTrigger value="sample">Sample data</TabsTrigger>{" "}
          <TabsTrigger value="access">Access control</TabsTrigger>{" "}
          <TabsTrigger value="preferences">Preferences</TabsTrigger>{" "}
        </TabsList>{" "}
        <TabsContent value="organisation" className="m-0 flex flex-col gap-4">
          <OrganizationPanel section="profile" />
        </TabsContent>{" "}
        <TabsContent value="offices" className="m-0 flex flex-col gap-4">
          <OrganizationPanel section="offices" />
        </TabsContent>{" "}
        <TabsContent value="numbering" className="m-0 flex flex-col gap-4">
          <OrganizationPanel section="numbering" />
        </TabsContent>{" "}
        <TabsContent value="inventory" className="m-0 flex flex-col gap-4">
          <InventorySetupPanel />
        </TabsContent>{" "}
        <TabsContent value="approvals" className="m-0 flex flex-col gap-4">
          <ApprovalPoliciesPanel />
        </TabsContent>{" "}
        <TabsContent value="late-fees" className="m-0 flex flex-col gap-4">
          <LateFeeRulesPanel />
        </TabsContent>{" "}
        <TabsContent value="cancellation" className="m-0 flex flex-col gap-4">
          <CancellationRulesPanel />
        </TabsContent>{" "}
        <TabsContent value="verification" className="m-0 flex flex-col gap-4">
          <DocumentVerificationPanel />
        </TabsContent>{" "}
        <TabsContent value="identity" className="m-0 flex flex-col gap-4">
          <IdentityProviderPanel />
        </TabsContent>{" "}
        <TabsContent value="targets" className="m-0 flex flex-col gap-4">
          <CollectionTargetsPanel />
        </TabsContent>{" "}
        <TabsContent
          value="chart-of-accounts"
          className="m-0 flex flex-col gap-4"
        >
          <ChartOfAccountsPanel />
        </TabsContent>{" "}
        <TabsContent value="journal" className="m-0 flex flex-col gap-4">
          <JournalExportPanel />
        </TabsContent>{" "}
        <TabsContent value="communications" className="m-0 flex flex-col gap-4">
          <CommunicationsPanel />
        </TabsContent>{" "}
        <TabsContent value="integrations" className="m-0 flex flex-col gap-4">
          <IntegrationsPanel />
        </TabsContent>{" "}
        <TabsContent value="sample" className="m-0 flex flex-col gap-4">
          <SampleDataPanel />
        </TabsContent>{" "}
        <TabsContent value="access" className="m-0 flex flex-col gap-4">
          {" "}
          <AccessControl />{" "}
        </TabsContent>{" "}
        <TabsContent value="preferences" className="m-0">
          {" "}
          <EmptyState
            icon={SlidersHorizontal}
            title="No preferences are stored"
            description="This deployment keeps no per-workspace preference record, so there is nothing to set here. Offices, document numbering, and member access are the settings it does hold, and each one is saved to the server."
          />{" "}
        </TabsContent>{" "}
      </Tabs>{" "}
    </div>
  )
}
