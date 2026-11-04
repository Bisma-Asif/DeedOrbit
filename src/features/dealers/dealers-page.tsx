import { useEffect, useMemo, useState } from "react"

import {
  Building2,
  CreditCard,
  GanttChartSquare,
  Plus,
  ReceiptText,
  UsersRound,
} from "lucide-react"

import { PageHeader } from "@/components/page-header"

import { EmptyState } from "@/components/empty-state"

import { Field, FieldGrid } from "@/components/field"

import { StatCard } from "@/components/stat-card"

import { Button } from "@/components/ui/button"

import { Badge } from "@/components/ui/badge"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { dealersApi, type DealerInput } from "@/lib/dealers-api"

import { formatCurrency, formatDate, formatNumber } from "@/lib/format"

import { useAsyncResource } from "@/lib/use-async-resource"

import { UNIT_TYPE_LABELS, UNIT_TYPES } from "@shared/inventory"

const EMPTY_FORM: DealerInput = {
  portalUserId: "",

  companyName: "",

  contactName: "",

  email: "",

  phone: "",

  businessRegistration: "",

  taxId: "",

  address: "",

  notes: "",

  status: "active",
}

type RuleFormState = {
  scope: "project" | "unit_type"

  projectId: string

  unitType: typeof UNIT_TYPES[number]

  commissionType: "percentage" | "fixed"

  commissionValue: string
}

function initials(name: string): string {
  return name

    .split(/\s+/)

    .filter(Boolean)

    .slice(0, 2)

    .map((part) => part.charAt(0).toUpperCase())

    .join("")
}

export function DealersPage() {
  const resource = useAsyncResource((signal) => dealersApi.list(signal))

  const dealers = resource.data?.dealers ?? []

  const canCreate = resource.data?.canCreate ?? false

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [form, setForm] = useState<DealerInput>(EMPTY_FORM)

  const [ruleForm, setRuleForm] = useState<RuleFormState>({
    scope: "project",

    projectId: "",

    unitType: "apartment",

    commissionType: "percentage",

    commissionValue: "5",
  })

  useEffect(() => {
    if (!dealers.length) {
      setSelectedId(null)

      setForm(EMPTY_FORM)

      return
    }

    if (selectedId && dealers.some((dealer) => dealer.id === selectedId)) return

    setSelectedId(dealers[0]!.id)
  }, [dealers, selectedId])

  const selectedDealer = useMemo(
    () => dealers.find((dealer) => dealer.id === selectedId) ?? null,

    [dealers, selectedId],
  )

  const detailResource = useAsyncResource(
    (signal) => {
      if (!selectedId) return Promise.resolve(null)

      return dealersApi.read(selectedId, signal)
    },

    Boolean(selectedId),
  )

  const detail = detailResource.data

  useEffect(() => {
    if (!selectedDealer) {
      setForm(EMPTY_FORM)

      return
    }

    setForm({
      portalUserId: selectedDealer.portalUserId ?? "",

      companyName: selectedDealer.companyName,

      contactName: selectedDealer.contactName,

      email: selectedDealer.email ?? "",

      phone: selectedDealer.phone,

      businessRegistration: selectedDealer.businessRegistration ?? "",

      taxId: selectedDealer.taxId ?? "",

      address: selectedDealer.address ?? "",

      notes: selectedDealer.notes ?? "",

      status: selectedDealer.status,
    })
  }, [selectedDealer])

  async function handleSaveDealer() {
    const payload = {
      ...form,

      companyName: form.companyName.trim(),

      contactName: form.contactName.trim(),

      email: form.email.trim(),

      phone: form.phone.trim(),

      businessRegistration: form.businessRegistration.trim(),

      taxId: form.taxId.trim(),

      address: form.address.trim(),

      notes: form.notes.trim(),

      portalUserId: form.portalUserId.trim(),
    }

    if (!payload.companyName || !payload.contactName || !payload.phone) return

    if (selectedId) {
      await dealersApi.update(selectedId, payload)
    } else {
      const result = await dealersApi.create(payload)

      setSelectedId(result.dealer.id)
    }

    await resource.reload()

    void detailResource.reload()
  }

  async function handleCreateRule() {
    if (!selectedId) return

    const value = Number(ruleForm.commissionValue)

    if (!Number.isFinite(value) || value < 0) return

    await dealersApi.createRule(selectedId, {
      scope: ruleForm.scope,

      projectId:
        ruleForm.scope === "project" ? ruleForm.projectId || null : null,

      unitType: ruleForm.scope === "unit_type" ? ruleForm.unitType : null,

      commissionType: ruleForm.commissionType,

      commissionValue: value,
    })

    await detailResource.reload()

    setRuleForm({
      scope: "project",

      projectId: "",

      unitType: "apartment",

      commissionType: "percentage",

      commissionValue: "5",
    })
  }

  async function handleDeleteRule(ruleId: string) {
    if (!selectedId) return

    await dealersApi.deleteRule(selectedId, ruleId)

    await detailResource.reload()
  }

  const totalPayable = dealers.reduce(
    (sum, dealer) => sum + dealer.commissionPayable,

    0,
  )

  const totalCommission = dealers.reduce(
    (sum, dealer) => sum + dealer.commissionTotal,

    0,
  )

  if (resource.error) {
    return (
      <div className="rounded-md border border-danger-border bg-danger-subtle p-3 text-[12.5px] text-danger">
        {resource.error}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dealers / Channel Partners"
        description="Onboard partners, manage commission rules, and track payable statements."
        actions={
          canCreate && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelectedId(null)

                setForm(EMPTY_FORM)
              }}
            >
              <Plus size={13} />
              Onboard dealer
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <StatCard
          label="Dealers"
          value={resource.loading ? undefined : formatNumber(dealers.length)}
        />
        <StatCard
          label="Leads assigned"
          value={
            resource.loading
              ? undefined
              : formatNumber(
                  dealers.reduce((sum, dealer) => sum + dealer.leadCount, 0),
                )
          }
        />
        <StatCard
          label="Commission total"
          value={
            resource.loading
              ? undefined
              : formatCurrency(totalCommission, "AED")
          }
        />
        <StatCard
          label="Payable now"
          value={
            resource.loading ? undefined : formatCurrency(totalPayable, "AED")
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Partner roster</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dealers.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No dealer records yet"
                description="Create a partner record to start assigning leads and managing rules."
                size="sm"
              />
            ) : (
              <div className="flex flex-col">
                {dealers.map((dealer) => (
                  <button
                    key={dealer.id}
                    type="button"
                    onClick={() => setSelectedId(dealer.id)}
                    className={[
                      "flex w-full items-center justify-between gap-3 border-b border-border px-3 py-3 text-left transition-colors",

                      dealer.id === selectedId
                        ? "bg-muted"
                        : "hover:bg-muted/60",
                    ].join(" ")}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-subtle text-[11px] font-semibold text-primary">
                        {initials(dealer.companyName)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-foreground">
                          {dealer.companyName}
                        </div>
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {dealer.contactName}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge
                        variant={
                          dealer.status === "active" ? "success" : "outline"
                        }
                      >
                        {dealer.status}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {formatCurrency(dealer.commissionPayable, "AED")}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedDealer
                  ? selectedDealer.companyName
                  : "New dealer profile"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGrid>
                <Field label="Company name" htmlFor="companyName" required>
                  <Input
                    value={form.companyName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,

                        companyName: event.target.value,
                      }))
                    }
                    placeholder="Alpha Estates"
                  />
                </Field>
                <Field label="Contact name" htmlFor="contactName" required>
                  <Input
                    value={form.contactName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,

                        contactName: event.target.value,
                      }))
                    }
                    placeholder="Maya Khan"
                  />
                </Field>
              </FieldGrid>

              <FieldGrid>
                <Field label="Phone" htmlFor="phone" required>
                  <Input
                    value={form.phone}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,

                        phone: event.target.value,
                      }))
                    }
                    placeholder="+971500000001"
                  />
                </Field>
                <Field label="Email" htmlFor="email">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,

                        email: event.target.value,
                      }))
                    }
                    placeholder="partner@example.com"
                  />
                </Field>
              </FieldGrid>

              <FieldGrid>
                <Field label="Dealer portal account" htmlFor="portalUserId">
                  <Select
                    value={form.portalUserId || ""}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        portalUserId: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select portal user" />
                    </SelectTrigger>
                    <SelectContent>
                      {(detail?.portalUsers ?? []).map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Status" htmlFor="status">
                  <Select
                    value={form.status}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,

                        status: value as "active" | "suspended",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGrid>

              <FieldGrid>
                <Field
                  label="Business registration"
                  htmlFor="businessRegistration"
                >
                  <Input
                    value={form.businessRegistration}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,

                        businessRegistration: event.target.value,
                      }))
                    }
                    placeholder="TRN or trade licence"
                  />
                </Field>
                <Field label="Tax ID" htmlFor="taxId">
                  <Input
                    value={form.taxId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,

                        taxId: event.target.value,
                      }))
                    }
                    placeholder="Tax reference"
                  />
                </Field>
              </FieldGrid>

              <Field label="Address" htmlFor="address">
                <Input
                  value={form.address}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      address: event.target.value,
                    }))
                  }
                  placeholder="Street, city, emirate"
                />
              </Field>

              <Field label="Notes" htmlFor="notes">
                <Textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      notes: event.target.value,
                    }))
                  }
                  placeholder="Short notes about partner relationships or contract terms."
                />
              </Field>

              <div className="flex justify-end">
                <Button type="button" onClick={() => void handleSaveDealer()}>
                  {selectedId ? "Save changes" : "Create dealer"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Commission rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGrid>
                <Field label="Rule scope" htmlFor="ruleScope">
                  <Select
                    value={ruleForm.scope}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({
                        ...current,

                        scope: value as "project" | "unit_type",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">Project</SelectItem>
                      <SelectItem value="unit_type">Unit type</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Commission type" htmlFor="ruleType">
                  <Select
                    value={ruleForm.commissionType}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({
                        ...current,

                        commissionType: value as "percentage" | "fixed",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="fixed">Fixed</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGrid>

              {ruleForm.scope === "project" ? (
                <Field label="Project" htmlFor="ruleProject">
                  <Select
                    value={ruleForm.projectId}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({
                        ...current,
                        projectId: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {(detail?.projects ?? []).map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label="Unit type" htmlFor="ruleUnitType">
                  <Select
                    value={ruleForm.unitType}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({
                        ...current,

                        unitType: value as typeof UNIT_TYPES[number],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_TYPES.map((unitType) => (
                        <SelectItem key={unitType} value={unitType}>
                          {UNIT_TYPE_LABELS[unitType]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <Field label="Value" htmlFor="ruleValue">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ruleForm.commissionValue}
                  onChange={(event) =>
                    setRuleForm((current) => ({
                      ...current,

                      commissionValue: event.target.value,
                    }))
                  }
                />
              </Field>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleCreateRule()}
                >
                  Add commission rule
                </Button>
              </div>

              <div className="space-y-2">
                {(detail?.rules ?? []).length === 0 ? (
                  <EmptyState
                    icon={GanttChartSquare}
                    title="No commission rules"
                    description="Set a project or unit-type rule to auto-calculate partner fees."
                    size="sm"
                  />
                ) : (
                  (detail?.rules ?? []).map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2"
                    >
                      <div>
                        <div className="text-[12.5px] font-medium text-foreground">
                          {rule.scope === "project"
                            ? (rule.projectName ?? "Project rule")
                            : rule.unitType
                              ? UNIT_TYPE_LABELS[rule.unitType]
                              : "Unit-type rule"}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {rule.commissionType === "percentage"
                            ? `${rule.commissionValue}%`
                            : `${formatCurrency(rule.commissionValue, "AED")}`}
                          • {rule.scope === "project" ? "project" : "unit type"}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDeleteRule(rule.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Assigned leads</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(detail?.leads ?? []).length === 0 ? (
                  <EmptyState
                    icon={UsersRound}
                    title="No assigned leads"
                    description="Linked leads will appear here with their latest status."
                    size="sm"
                  />
                ) : (
                  (detail?.leads ?? []).map((lead) => (
                    <div
                      key={lead.id}
                      className="rounded-md border border-border bg-muted/40 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12.5px] font-medium text-foreground">
                          {lead.name}
                        </div>
                        <Badge
                          variant={
                            lead.status === "converted" ? "success" : "outline"
                          }
                        >
                          {lead.statusLabel}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11.5px] text-muted-foreground">
                        {lead.projectInterest ?? "No project interest"} •{" "}
                        {lead.phone}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bookings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(detail?.bookings ?? []).length === 0 ? (
                  <EmptyState
                    icon={ReceiptText}
                    title="No bookings yet"
                    description="Confirmed deals from this partner will show here."
                    size="sm"
                  />
                ) : (
                  (detail?.bookings ?? []).map((booking) => (
                    <div
                      key={booking.id}
                      className="rounded-md border border-border bg-muted/40 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12.5px] font-medium text-foreground">
                          {booking.bookingReference}
                        </div>
                        <Badge
                          variant={
                            booking.status === "confirmed"
                              ? "success"
                              : booking.status === "pending"
                                ? "pending"
                                : "outline"
                          }
                        >
                          {booking.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11.5px] text-muted-foreground">
                        {booking.customerName} • {booking.projectName} •{" "}
                        {booking.unitType}
                      </div>
                      <div className="mt-1 text-[11.5px] text-muted-foreground">
                        {formatCurrency(booking.bookingAmount, "AED")} •{" "}
                        {formatDate(booking.bookingDate)}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Commission statement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="text-[11px] text-muted-foreground">
                    Total commission
                  </div>
                  <div className="mt-1 text-[13px] font-semibold text-foreground">
                    {detail
                      ? formatCurrency(detail.statement.totalCommission, "AED")
                      : "—"}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="text-[11px] text-muted-foreground">Paid</div>
                  <div className="mt-1 text-[13px] font-semibold text-foreground">
                    {detail
                      ? formatCurrency(detail.statement.totalPaid, "AED")
                      : "—"}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <div className="text-[11px] text-muted-foreground">
                    Payable
                  </div>
                  <div className="mt-1 text-[13px] font-semibold text-foreground">
                    {detail
                      ? formatCurrency(detail.statement.totalPayable, "AED")
                      : "—"}
                  </div>
                </div>
              </div>

              {(detail?.statement.entries ?? []).length === 0 ? (
                <EmptyState
                  icon={CreditCard}
                  title="No statement entries"
                  description="Once bookings are confirmed, the commission ledger will populate here."
                  size="sm"
                />
              ) : (
                <div className="space-y-2">
                  {(detail?.statement.entries ?? []).map((entry) => (
                    <div
                      key={entry.bookingId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
                    >
                      <div>
                        <div className="text-[12.5px] font-medium text-foreground">
                          {entry.reference}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {entry.customerName} • {entry.projectName} •{" "}
                          {formatDate(entry.bookingDate)}
                        </div>
                      </div>
                      <div className="text-right text-[11.5px] text-muted-foreground">
                        <div>
                          {entry.commissionType === "percentage"
                            ? `${entry.commissionValue ?? 0}%`
                            : formatCurrency(entry.commissionValue ?? 0, "AED")}
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {formatCurrency(entry.payable, "AED")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
