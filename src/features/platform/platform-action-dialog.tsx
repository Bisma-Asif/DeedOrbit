/**
 * The platform action dialogs for one workspace.
 *
 * One component switching on the open action, because all seven share the same
 * skeleton: a short form, the server's refusal surfaced as an alert, and a
 * reload of the tenant view on success. Which actions are offered at all is
 * decided by the caller from the derived billing state - the server refuses
 * the same combinations again, so hiding is convenience and the refusal is
 * the rule.
 *
 * Amounts default to the plan's list price because that is what the platform
 * charges; a workspace on an unknown plan has no default, and the dialog says
 * so instead of inventing one.
 */

import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { useSave } from "@/features/organization/use-save"

import { formatCurrency } from "@/lib/format"

import { platformApi, type PlatformTenantView } from "@/lib/platform-api"

import {
  GRACE_DAYS_MAX,
  GRACE_DAYS_MIN,
  PLATFORM_PLANS,
  PLAN_DEFINITIONS,
} from "@shared/platform"

export type PlatformTenantAction = "invoice" | "payment" | "due" | "grace" | "suspend" | "reactivate" | "plan"

interface PlatformActionDialogProps {
  action: PlatformTenantAction | null

  tenant: PlatformTenantView

  onClose: () => void

  onDone: () => void
}

interface ActionCopy {
  title: string

  confirm: string

  busy: string
}

const ACTION_COPY: Record<PlatformTenantAction, ActionCopy> = {
  invoice: {
    title: "Record invoice",
    confirm: "Record invoice",
    busy: "Recording…",
  },

  payment: {
    title: "Record payment",
    confirm: "Record payment",
    busy: "Recording…",
  },

  due: { title: "Mark payment due", confirm: "Mark due", busy: "Marking…" },

  grace: {
    title: "Grant grace period",
    confirm: "Grant grace",
    busy: "Granting…",
  },

  suspend: {
    title: "Suspend workspace",
    confirm: "Suspend workspace",
    busy: "Suspending…",
  },

  reactivate: {
    title: "Reactivate workspace",
    confirm: "Reactivate",
    busy: "Reactivating…",
  },

  plan: { title: "Change plan", confirm: "Change plan", busy: "Changing…" },
}

export function PlatformActionDialog({
  action,

  tenant,

  onClose,

  onDone,
}: PlatformActionDialogProps) {
  if (!action) return null

  return (
    <ActionForm
      // Remount per action so a draft never carries across dialogs.

      key={action}
      action={action}
      tenant={tenant}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

interface ActionFormProps {
  action: PlatformTenantAction

  tenant: PlatformTenantView

  onClose: () => void

  onDone: () => void
}

function ActionForm({ action, tenant, onClose, onDone }: ActionFormProps) {
  const save = useSave()

  const copy = ACTION_COPY[action]

  const isMoney = action === "invoice" || action === "payment"

  const [amount, setAmount] = useState(
    tenant.monthlyAmount === null ? "" : String(tenant.monthlyAmount),
  )

  const [note, setNote] = useState("")

  const [days, setDays] = useState("14")

  const [reason, setReason] = useState("")

  const [plan, setPlan] = useState(
    PLATFORM_PLANS.includes(tenant.plan as never) ? tenant.plan : "standard",
  )

  useEffect(() => {
    save.clear()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  async function submit() {
    const done = await save.run(async () => {
      const moneyInput = amount.trim() === "" ? {} : { amount: Number(amount) }

      switch (action) {
        case "invoice":
          await platformApi.invoice(tenant.id, {
            ...moneyInput,

            ...(note.trim() ? { note: note.trim() } : {}),
          })

          break

        case "payment":
          await platformApi.payment(tenant.id, {
            ...moneyInput,

            ...(note.trim() ? { note: note.trim() } : {}),
          })

          break

        case "due":
          await platformApi.markDue(tenant.id, {
            ...(note.trim() ? { note: note.trim() } : {}),
          })

          break

        case "grace":
          await platformApi.grace(tenant.id, {
            days: Number(days),

            reason: reason.trim(),
          })

          break

        case "suspend":
          await platformApi.suspend(tenant.id, {
            ...(note.trim() ? { reason: note.trim() } : {}),
          })

          break

        case "reactivate":
          await platformApi.reactivate(tenant.id, {
            ...(note.trim() ? { note: note.trim() } : {}),
          })

          break

        case "plan":
          await platformApi.setPlan(tenant.id, { plan })

          break
      }

      onDone()
    })

    if (done) onClose()
  }

  const missingAmount =
    isMoney && amount.trim() === "" && tenant.monthlyAmount === null

  const missingReason = action === "grace" && reason.trim().length < 4

  const invalidDays =
    action === "grace" &&
    (!Number.isInteger(Number(days)) ||
      Number(days) < GRACE_DAYS_MIN ||
      Number(days) > GRACE_DAYS_MAX)

  const blocked =
    save.saving ||
    (isMoney && amount.trim() !== "" && !(Number(amount) >= 0)) ||
    missingAmount ||
    missingReason ||
    invalidDays

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {tenant.name} · {tenant.planLabel ?? "Unknown plan"} ·{" "}
            {tenant.currency}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          {action === "suspend" && (
            <Alert variant="pending">
              <AlertDescription>
                Staff sessions for this workspace are revoked and sign-in is
                refused until it is reactivated. Billing returns as due, not
                paid.
              </AlertDescription>
            </Alert>
          )}

          {action === "reactivate" && (
            <Alert variant="pending">
              <AlertDescription>
                The workspace can be signed into again. Its billing returns to{" "}
                <strong>payment due</strong> - reactivating does not write off
                the outstanding balance.
              </AlertDescription>
            </Alert>
          )}

          {isMoney && (
            <Field
              label={`Amount (${tenant.currency})`}
              htmlFor="platform-amount"
              required
              hint={
                tenant.monthlyAmount === null
                  ? "No plan default exists for this workspace - enter the amount recorded."
                  : `Defaults to the ${tenant.planLabel} list price of ${formatCurrency(tenant.monthlyAmount, tenant.currency)}.`
              }
            >
              <Input
                id="platform-amount"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value)

                  save.clear()
                }}
              />
            </Field>
          )}

          {action === "grace" && (
            <Field
              label="Days of grace"
              htmlFor="platform-grace-days"
              required
              hint={`Between ${GRACE_DAYS_MIN} and ${GRACE_DAYS_MAX} days. An open grace window is extended from its own end.`}
            >
              <Input
                id="platform-grace-days"
                type="number"
                min={GRACE_DAYS_MIN}
                max={GRACE_DAYS_MAX}
                step={1}
                inputMode="numeric"
                value={days}
                onChange={(event) => {
                  setDays(event.target.value)

                  save.clear()
                }}
              />
            </Field>
          )}

          {action === "grace" && (
            <Field
              label="Reason"
              htmlFor="platform-grace-reason"
              required
              hint="A granted grace has to be explainable later."
            >
              <Input
                id="platform-grace-reason"
                value={reason}
                maxLength={200}
                onChange={(event) => {
                  setReason(event.target.value)

                  save.clear()
                }}
              />
            </Field>
          )}

          {action === "plan" && (
            <Field label="New plan" htmlFor="platform-plan" required>
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger id="platform-plan">
                  <SelectValue placeholder="Choose a plan" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_PLANS.filter(
                    (option) => option !== tenant.plan,
                  ).map((option) => (
                    <SelectItem key={option} value={option}>
                      {PLAN_DEFINITIONS[option].label} —{" "}
                      {formatCurrency(
                        PLAN_DEFINITIONS[option].monthlyAmount,

                        tenant.currency,
                      )}
                      /mo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {(action === "invoice" ||
            action === "payment" ||
            action === "due" ||
            action === "suspend" ||
            action === "reactivate") && (
            <Field
              label={
                action === "suspend" ? "Reason (optional)" : "Note (optional)"
              }
              htmlFor="platform-note"
            >
              <Textarea
                id="platform-note"
                value={note}
                rows={3}
                maxLength={300}
                placeholder={
                  action === "suspend"
                    ? "Why the workspace is being suspended"
                    : "Reference, actor, or context for the ledger"
                }
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button
            variant={action === "suspend" ? "danger" : "default"}
            onClick={() => void submit()}
            disabled={blocked}
          >
            {save.saving ? copy.busy : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
