/**
 * New / edit an expense.
 *
 * A draft is opened here and moves through submit -> approve -> mark-paid on
 * the detail page. The dialog carries only the fields the server lets a draft
 * change: category, optional project and vendor, a description, a whole-unit
 * amount, and the date the spend occurred. Money never moves until a second
 * user signs it off, so nothing here touches a ledger.
 *
 * Project and vendor pickers read their lists lazily so the dialog opens fast
 * on a workspace with a large portfolio or supplier book.
 */

import { useEffect, useMemo, useState } from "react"

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

import { projectsApi } from "@/lib/projects-api"

import { vendorsApi } from "@/lib/vendors-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_AMOUNT_MAX,
  EXPENSE_DESCRIPTION_MAX,
  type Expense,
  type ExpenseCategory,
} from "@shared/expenses"

import { expensesApi, type ExpenseInput } from "@/lib/expenses-api"

interface ExpenseFormDialogProps {
  open: boolean

  onOpenChange: (open: boolean) => void

  /** Present when editing an existing draft; `null` opens in create mode. */

  expense: Expense | null

  onSaved: (expense: Expense) => void
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyDraft(): ExpenseInput {
  return {
    category: "office",

    projectId: null,

    vendorId: null,

    description: "",

    amount: 0,

    occurredAt: todayDate(),
  }
}

function fromExpense(expense: Expense): ExpenseInput {
  return {
    category: expense.category,

    projectId: expense.projectId,

    vendorId: expense.vendorId,

    description: expense.description,

    amount: expense.amount,

    occurredAt: expense.occurredAt.slice(0, 10),
  }
}

export function ExpenseFormDialog({
  open,

  onOpenChange,

  expense,

  onSaved,
}: ExpenseFormDialogProps) {
  const [draft, setDraft] = useState<ExpenseInput>(() => emptyDraft())

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  const projects = useAsyncResource(
    (signal) => projectsApi.list(signal),

    open,
  )

  const vendors = useAsyncResource(
    (signal) => vendorsApi.list({}, signal),

    open,
  )

  useEffect(() => {
    if (!open) return

    setDraft(expense ? fromExpense(expense) : emptyDraft())

    setInvalid({})

    save.clear()

    // `save` is stable; listing it in the deps would loop the reset.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense])

  const projectOptions = useMemo(
    () => projects.data?.projects ?? [],
    [projects.data],
  )

  const vendorOptions = useMemo(
    () => vendors.data?.vendors ?? [],
    [vendors.data],
  )

  async function submit() {
    const errors: Record<string, string> = {}

    if (draft.description.trim() === "") {
      errors.description = "Describe what this spend is for."
    } else if (draft.description.length > EXPENSE_DESCRIPTION_MAX) {
      errors.description = `Use ${EXPENSE_DESCRIPTION_MAX} characters or fewer.`
    }

    if (
      !Number.isSafeInteger(draft.amount) ||
      draft.amount <= 0 ||
      draft.amount > EXPENSE_AMOUNT_MAX
    ) {
      errors.amount = `Enter a whole number from 1 to ${EXPENSE_AMOUNT_MAX}.`
    }

    if (!draft.occurredAt)
      errors.occurredAt = "Enter the date the spend occurred."

    if (Object.keys(errors).length > 0) {
      save.clear()

      setInvalid(errors)

      return
    }

    setInvalid({})

    const body: ExpenseInput = {
      ...draft,

      description: draft.description.trim(),

      occurredAt: `${draft.occurredAt}T00:00:00.000Z`,
    }

    const done = await save.run(async () => {
      const result = expense
        ? await expensesApi.update(expense.id, body)
        : await expensesApi.create(body)

      onSaved(result.expense)
    })

    if (done) onOpenChange(false)
  }

  const errorFor = (key: string) => invalid[key] ?? save.fields[key]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[36rem]">
        <DialogHeader>
          <DialogTitle>{expense ? "Edit expense" : "New expense"}</DialogTitle>
          <DialogDescription>
            Draft an expense. Money does not move until it is approved and
            marked paid.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {save.error ? (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="expense-category">
              <Select
                value={draft.category}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,

                    category: value as ExpenseCategory,
                  }))
                }
              >
                <SelectTrigger id="expense-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {EXPENSE_CATEGORY_LABELS[category]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Occurred on"
              htmlFor="expense-occurred"
              error={errorFor("occurredAt")}
            >
              <Input
                id="expense-occurred"
                type="date"
                value={draft.occurredAt.slice(0, 10)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,

                    occurredAt: event.target.value,
                  }))
                }
              />
            </Field>
          </div>

          <Field label="Project (optional)" htmlFor="expense-project">
            <Select
              value={draft.projectId ?? "__none"}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,

                  projectId: value === "__none" ? null : value,
                }))
              }
            >
              <SelectTrigger id="expense-project">
                <SelectValue placeholder="Not tied to a project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Not tied to a project</SelectItem>
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                    {project.code ? ` · ${project.code}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Vendor (optional)" htmlFor="expense-vendor">
            <Select
              value={draft.vendorId ?? "__none"}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,

                  vendorId: value === "__none" ? null : value,
                }))
              }
            >
              <SelectTrigger id="expense-vendor">
                <SelectValue placeholder="Not paid to a vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Not paid to a vendor</SelectItem>
                {vendorOptions.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Amount"
            htmlFor="expense-amount"
            error={errorFor("amount")}
          >
            <Input
              id="expense-amount"
              type="number"
              min={1}
              max={EXPENSE_AMOUNT_MAX}
              step={1}
              inputMode="numeric"
              value={draft.amount === 0 ? "" : String(draft.amount)}
              onChange={(event) => {
                const raw = event.target.value.trim()

                const parsed = raw === "" ? 0 : Math.trunc(Number(raw))

                setDraft((current) => ({
                  ...current,

                  amount: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                }))

                setInvalid((current) => {
                  if (!("amount" in current)) return current

                  const next = { ...current }

                  delete next.amount

                  return next
                })

                save.clear()
              }}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="expense-description"
            error={errorFor("description")}
          >
            <Textarea
              id="expense-description"
              rows={3}
              maxLength={EXPENSE_DESCRIPTION_MAX}
              value={draft.description}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,

                  description: event.target.value,
                }))

                setInvalid((current) => {
                  if (!("description" in current)) return current

                  const next = { ...current }

                  delete next.description

                  return next
                })

                save.clear()
              }}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.saving}>
            {save.saving ? "Saving…" : expense ? "Save draft" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
