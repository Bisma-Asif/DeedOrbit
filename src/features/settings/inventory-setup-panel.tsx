/**
 * Settings > Inventory Setup — the nine property-category lists.
 *
 * Migration 0054 moved "what kind of thing is this unit" out of the code and into
 * `inventory_category_options`: property type, usage, sub-type, furnishing, sale mode,
 * possession, ownership, size unit and amenities, one set of rows per workspace. This is
 * the screen that owns them, and it is deliberately a configuration screen rather than a
 * second copy of the inventory table — the unit form reads the same vocabulary, and a
 * workspace that calls its stock "Flats" instead of "Apartments" should only have to say
 * it once, here.
 *
 * Three rules the server enforces and this panel repeats, because a control that lies is
 * worse than no control:
 *
 *  * A rename never moves a stored key while a unit holds it. The count beside each row is
 *    the reason: "42 units" means the word in front of you is cosmetic, and the rows those
 *    units store keep resolving here.
 *
 *  * An option is retired, never deleted. Retiring hides it from every picker and leaves
 *    existing units intact, so a Kiosk line retired last year still prints "Kiosk" on the
 *    quotation a buyer signed in March.
 *
 *  * Built-in rows are editable. A status is a state the product counts and colours, so
 *    the shipped ones are frozen; a category is a word a sales desk uses, and the whole
 *    point of the feature is that this workspace gets to choose it.
 *
 * Reads need `inventory.view`, writes need `settings.edit`, and `canManage` comes from the
 * response rather than from a client-side guess, so the panel asks for the grant the same
 * way the server checks it.
 */

import { useState } from "react"

import { Archive, ArchiveRestore, Check, Lock, Pencil, X } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Field, FieldGrid } from "@/components/field"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Skeleton } from "@/components/ui/skeleton"

import { Switch } from "@/components/ui/switch"

import { useSave } from "@/features/organization/use-save"

import {
  inventoryCategoriesApi,
  optionsOf,
  unitsHoldingOption,
  type InventoryOptionView,
  type InventoryOptionsResponse,
} from "@/lib/inventory-categories-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatNumber } from "@/lib/format"

import {
  INVENTORY_OPTION_KIND_HINTS,
  INVENTORY_OPTION_KIND_LABELS,
  INVENTORY_OPTION_KINDS,
  INVENTORY_OPTION_LABEL_MAX,
  INVENTORY_OPTION_MAX_PER_KIND,
  UNIT_SIZE_VALUE_MAX,
  UNIT_SIZE_VALUE_MIN,
  type InventoryOptionKind,
} from "@shared/inventory-categories"

import { UNIT_TYPES, UNIT_TYPE_LABELS, type UnitType } from "@shared/inventory"

/** One editable option, held as typed text until it is sent. */

interface OptionDraft {
  label: string

  /** Sub-types only: the property type the variant hangs off. */

  parentKey: string

  /** Property types only: the coarse family `unit_type` still records. */

  unitType: string

  /** Property types only: the usage category picked alongside it. */

  usageKey: string

  /** Property types only: bare land, which is what hides bedrooms on the form. */

  isLand: boolean

  /** Size units only: square feet per one of this unit. */

  valueNum: string
}

const BLANK_DRAFT: OptionDraft = {
  label: "",

  parentKey: "",

  unitType: "",

  usageKey: "",

  isLand: false,

  valueNum: "",
}

/** A stored option, turned back into a draft for the inline editor. */

function draftFromOption(option: InventoryOptionView): OptionDraft {
  return {
    label: option.label,

    parentKey: option.parentKey ?? "",

    unitType: option.legacyType ?? "",

    usageKey: option.usageKey ?? "",

    isLand: option.isLand,

    valueNum: option.valueNum === null ? "" : String(option.valueNum),
  }
}

/** What a write sends for one option — only the fields this kind carries. */

interface OptionWrite {
  label: string

  parentKey?: string

  unitType?: UnitType

  usageKey?: string

  isLand?: boolean

  valueNum?: number
}

export function InventorySetupPanel() {
  const resource = useAsyncResource((signal) =>
    inventoryCategoriesApi.list(signal),
  )

  if (resource.error && !resource.data) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (!resource.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inventory setup</CardTitle>
          <CardDescription>Loading the property category lists</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  const response = resource.data

  return (
    <div className="flex flex-col gap-4">
      {!response.canManage ? (
        <Alert>
          <Lock size={14} className="mt-0.5 shrink-0" />
          <AlertDescription>
            Your role can see these lists and use them on a unit, but cannot
            change them. Ask a workspace administrator for the settings grant to
            add, rename, or retire an option.
          </AlertDescription>
        </Alert>
      ) : null}

      {INVENTORY_OPTION_KINDS.map((kind) => (
        <CategoryListCard
          key={kind}
          kind={kind}
          response={response}
          onChanged={resource.reload}
        />
      ))}
    </div>
  )
}

interface CategoryListCardProps {
  kind: InventoryOptionKind

  response: InventoryOptionsResponse

  onChanged: () => void
}

/**
 * One list: its live rows, its retired rows, and the add form.
 *
 * Every kind renders the same shell, with the controls a kind actually uses appearing
 * beside it — a square-foot factor only on a size unit, a family and a usage only on a
 * property type, a parent only on a sub-type. The nine lists are one table on the server,
 * and a form that showed all of those columns on all of them would be a grid of dashes.
 */

function CategoryListCard({
  kind,

  response,

  onChanged,
}: CategoryListCardProps) {
  const canManage = response.canManage

  const live = response.options[kind] ?? []

  const retired = response.archived[kind] ?? []

  const save = useSave()

  const [draft, setDraft] = useState<OptionDraft>(BLANK_DRAFT)

  const [editingId, setEditingId] = useState<string | null>(null)

  const [editDraft, setEditDraft] = useState<OptionDraft>(BLANK_DRAFT)

  const [localError, setLocalError] = useState<string | null>(null)

  const full = live.length + retired.length >= INVENTORY_OPTION_MAX_PER_KIND

  function patch(next: Partial<OptionDraft>) {
    setDraft((current) => ({ ...current, ...next }))

    setLocalError(null)

    save.clear()
  }

  function patchEdit(next: Partial<OptionDraft>) {
    setEditDraft((current) => ({ ...current, ...next }))

    save.clear()
  }

  function beginEdit(option: InventoryOptionView) {
    setEditingId(option.id)

    setEditDraft(draftFromOption(option))

    save.clear()
  }

  function cancelEdit() {
    setEditingId(null)

    save.clear()
  }

  /** The write for either half of the form: a create sends everything, a PATCH only what this kind carries. */

  function inputFor(target: OptionDraft): OptionWrite {
    const label = target.label.trim()

    if (kind === "property_subtype") {
      return {
        label,

        parentKey: target.parentKey || undefined,
      }
    }

    if (kind === "property_type") {
      return {
        label,

        unitType: (target.unitType || undefined) as UnitType | undefined,

        usageKey: target.usageKey || undefined,

        isLand: target.isLand,
      }
    }

    if (kind === "size_unit") {
      return {
        label,

        valueNum:
          target.valueNum.trim() === "" ? undefined : Number(target.valueNum),
      }
    }

    return { label }
  }

  async function submitAdd() {
    if (draft.label.trim() === "") {
      setLocalError("Give the option a name.")

      return
    }

    if (kind === "property_subtype" && draft.parentKey === "") {
      setLocalError("Choose which property type this variant belongs to.")

      return
    }

    setLocalError(null)

    const created = await save.run(async () => {
      await inventoryCategoriesApi.create({
        kind,

        ...inputFor(draft),
      })
    })

    if (created) {
      setDraft(BLANK_DRAFT)

      onChanged()
    }
  }

  async function submitEdit(option: InventoryOptionView) {
    if (editDraft.label.trim() === "") {
      setLocalError("Give the option a name.")

      return
    }

    setLocalError(null)

    const updated = await save.run(async () => {
      await inventoryCategoriesApi.update(option.id, inputFor(editDraft))
    })

    if (updated) {
      setEditingId(null)

      onChanged()
    }
  }

  async function setArchived(option: InventoryOptionView, isArchived: boolean) {
    setLocalError(null)

    const done = await save.run(async () => {
      await inventoryCategoriesApi.update(option.id, { isArchived })
    })

    if (done) onChanged()
  }

  const unitsFor = (option: InventoryOptionView) =>
    unitsHoldingOption(response.unitCounts, kind, option.key)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{INVENTORY_OPTION_KIND_LABELS[kind]}</CardTitle>
        <CardDescription>{INVENTORY_OPTION_KIND_HINTS[kind]}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-1.5">
        {save.error && (
          <Alert variant="danger" className="mb-2">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        )}

        {localError && (
          <Alert variant="danger" className="mb-2">
            <AlertDescription>{localError}</AlertDescription>
          </Alert>
        )}

        {live.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted-foreground">
            Nothing is offered in this list yet.
          </p>
        ) : null}

        {live.map((option) =>
          editingId === option.id ? (
            <OptionEditor
              key={option.id}
              kind={kind}
              response={response}
              draft={editDraft}
              errors={save.fields}
              saving={save.saving}
              onChange={patchEdit}
              onSave={() => void submitEdit(option)}
              onCancel={cancelEdit}
            />
          ) : (
            <OptionRow
              key={option.id}
              option={option}
              kind={kind}
              response={response}
              units={unitsFor(option)}
              canManage={canManage}
              saving={save.saving}
              onEdit={() => beginEdit(option)}
              onRetire={() => void setArchived(option, true)}
            />
          ),
        )}

        {retired.length > 0 ? (
          <>
            <p className="mt-3 mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Retired
            </p>

            {retired.map((option) => (
              <OptionRow
                key={option.id}
                option={option}
                kind={kind}
                response={response}
                units={unitsFor(option)}
                canManage={canManage}
                saving={save.saving}
                onEdit={() => beginEdit(option)}
                onRetire={() => void setArchived(option, false)}
              />
            ))}
          </>
        ) : null}

        {canManage ? (
          <div className="mt-3 border-t border-border pt-3">
            <OptionEditor
              kind={kind}
              response={response}
              draft={draft}
              errors={save.fields}
              saving={save.saving}
              addMode
              disabled={full}
              onChange={patch}
              onSave={() => void submitAdd()}
              onCancel={() => {
                setDraft(BLANK_DRAFT)

                setLocalError(null)
              }}
            />

            {full ? (
              <p className="mt-1.5 text-[11.5px] text-warning">
                {INVENTORY_OPTION_MAX_PER_KIND} entries is the limit for one
                list. Retire one to add another.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** What one row says about itself beyond its name, as the kind uses it. */

function optionDetail(
  option: InventoryOptionView,

  kind: InventoryOptionKind,

  response: InventoryOptionsResponse,
): string | null {
  if (kind === "size_unit") {
    return option.valueNum === null
      ? null
      : `${formatNumber(option.valueNum)} sq ft per unit`
  }

  if (kind === "property_subtype") {
    const parent =
      option.parentKey === null
        ? undefined
        : (response.options.property_type ?? []).find(
            (type) => type.key === option.parentKey,
          )

    return `under ${parent?.label ?? option.parentKey ?? "no property type"}`
  }

  if (kind === "property_type") {
    const usage =
      option.usageKey === null
        ? undefined
        : (response.options.usage_category ?? []).find(
            (entry) => entry.key === option.usageKey,
          )

    const family = option.legacyType
      ? UNIT_TYPE_LABELS[option.legacyType]
      : "no family"

    return `${family} · ${usage?.label ?? "usage not set"}`
  }

  return null
}

interface OptionRowProps {
  option: InventoryOptionView

  kind: InventoryOptionKind

  response: InventoryOptionsResponse

  units: number

  canManage: boolean

  saving: boolean

  onEdit: () => void

  onRetire: () => void
}

/**
 * A row, its counts, and what a manager can do to it.
 *
 * The unit count is the number that makes a retire safe or unsafe, so it sits on the row
 * rather than behind a tooltip: "42 units" beside Shop is the reason retiring it hides a
 * picker instead of rewriting history.
 */

function OptionRow({
  option,

  kind,

  response,

  units,

  canManage,

  saving,

  onEdit,

  onRetire,
}: OptionRowProps) {
  const detail = optionDetail(option, kind, response)

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-2.5 py-2">
      <div className="min-w-0">
        <p className="truncate text-[13px] text-foreground">
          {option.label}
          {option.isArchived ? (
            <span className="ml-2 text-[11px] text-muted-foreground">
              retired
            </span>
          ) : null}
        </p>

        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {detail !== null ? <span>{detail} · </span> : null}

          <span className="font-mono">{option.key}</span>
          {" · "}
          {units === 0
            ? "no units"
            : `${formatNumber(units)} ${units === 1 ? "unit" : "units"}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {option.isBuiltin ? (
          <Badge variant="neutral" className="text-[10px]">
            shipped
          </Badge>
        ) : null}

        {canManage ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 text-muted-foreground"
              aria-label={`Edit ${option.label}`}
              disabled={saving}
              onClick={onEdit}
            >
              <Pencil size={14} />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 text-muted-foreground"
              aria-label={
                option.isArchived
                  ? `Offer ${option.label} again`
                  : `Retire ${option.label}`
              }
              title={
                option.isArchived
                  ? "Bring this option back into the pickers"
                  : units > 0
                    ? `Hidden from new units; the ${units} already using it keep this name`
                    : "Hidden from every picker"
              }
              disabled={saving}
              onClick={onRetire}
            >
              {option.isArchived ? (
                <ArchiveRestore size={14} />
              ) : (
                <Archive size={14} />
              )}
            </Button>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">read only</span>
        )}
      </div>
    </div>
  )
}

interface OptionEditorProps {
  kind: InventoryOptionKind

  response: InventoryOptionsResponse

  draft: OptionDraft

  errors: Record<string, string>

  saving: boolean

  /** The add form says "Add"; an open row says "Save". */

  addMode?: boolean

  disabled?: boolean

  onChange: (patch: Partial<OptionDraft>) => void

  onSave: () => void

  onCancel: () => void
}

/**
 * Name, plus only the controls this kind carries.
 *
 * Shared between "add a new option" and "edit this one" because they are the same
 * question with different answers, and a manager should not have to learn two forms.
 */

function OptionEditor({
  kind,

  response,

  draft,

  errors,

  saving,

  addMode = false,

  disabled = false,

  onChange,

  onSave,

  onCancel,
}: OptionEditorProps) {
  const idPrefix = addMode ? `new-${kind}` : `edit-${kind}`

  const propertyTypes =
    kind === "property_subtype" ? optionsOf(response, "property_type") : []

  const usages =
    kind === "property_type" ? optionsOf(response, "usage_category") : []

  return (
    <div className="rounded-md border border-border bg-card-subtle/40 p-2.5">
      <Field
        label="Name"
        htmlFor={`${idPrefix}-label`}
        required
        error={errors.label}
        hint={
          addMode
            ? kind === "property_type"
              ? "The stored key is made from this name; units already saved keep theirs."
              : "Shown in every picker and printed on every document."
            : "Renaming changes the word only — units that hold this option keep resolving to it."
        }
      >
        <Input
          id={`${idPrefix}-label`}
          value={draft.label}
          maxLength={INVENTORY_OPTION_LABEL_MAX}
          autoComplete="off"
          placeholder={addMode ? "Guest House" : ""}
          disabled={saving}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </Field>

      {kind === "property_subtype" && propertyTypes.length > 0 ? (
        <div className="mt-2.5">
          <Field
            label="Property type"
            htmlFor={`${idPrefix}-parent`}
            required
            error={errors.parentKey}
            hint="Only the variants of this type are offered on a unit."
          >
            <Select
              value={draft.parentKey}
              onValueChange={(value) => onChange({ parentKey: value })}
            >
              <SelectTrigger
                id={`${idPrefix}-parent`}
                aria-label="Property type"
              >
                <SelectValue placeholder="Choose a property type" />
              </SelectTrigger>

              <SelectContent>
                {propertyTypes.map((option) => (
                  <SelectItem key={option.id} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}

      {kind === "property_type" ? (
        <FieldGrid className="mt-2.5">
          <Field
            label="Family"
            htmlFor={`${idPrefix}-unit-type`}
            error={errors.unitType}
            hint="Reports and dealer scopes still count by these five."
          >
            <Select
              value={draft.unitType}
              onValueChange={(value) => onChange({ unitType: value })}
            >
              <SelectTrigger id={`${idPrefix}-unit-type`} aria-label="Family">
                <SelectValue placeholder="Plot" />
              </SelectTrigger>

              <SelectContent>
                {UNIT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {UNIT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Default usage"
            htmlFor={`${idPrefix}-usage`}
            error={errors.usageKey}
            hint="What the unit form preselects when this type is chosen."
          >
            <Select
              value={draft.usageKey}
              onValueChange={(value) => onChange({ usageKey: value })}
            >
              <SelectTrigger
                id={`${idPrefix}-usage`}
                aria-label="Default usage"
              >
                <SelectValue placeholder="From the list" />
              </SelectTrigger>

              <SelectContent>
                {usages.map((option) => (
                  <SelectItem key={option.id} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGrid>
      ) : null}

      {kind === "property_type" ? (
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2">
          <div>
            <p className="text-[12.5px] text-foreground">Bare land</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Hides bedrooms, bathrooms and floors on a unit of this type.
            </p>
          </div>

          <Switch
            checked={draft.isLand}
            aria-label="Bare land"
            onCheckedChange={(checked) =>
              onChange({ isLand: checked === true })
            }
          />
        </div>
      ) : null}

      {kind === "size_unit" ? (
        <div className="mt-2.5">
          <Field
            label="Square feet per unit"
            htmlFor={`${idPrefix}-value`}
            required
            error={errors.valueNum}
            hint={`A marla is 225 sq ft in most of Punjab and 242 in parts of Sindh. Between ${UNIT_SIZE_VALUE_MIN} and ${formatNumber(UNIT_SIZE_VALUE_MAX)}.`}
          >
            <Input
              id={`${idPrefix}-value`}
              type="number"
              inputMode="decimal"
              min={UNIT_SIZE_VALUE_MIN}
              max={UNIT_SIZE_VALUE_MAX}
              step="0.01"
              value={draft.valueNum}
              placeholder="225"
              onChange={(event) => onChange({ valueNum: event.target.value })}
            />
          </Field>
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving || disabled}
          onClick={onSave}
        >
          <Check size={13} />
          {addMode ? "Add option" : "Save"}
        </Button>

        {!addMode ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={onCancel}
          >
            <X size={13} />
            Cancel
          </Button>
        ) : null}

        <span className="ml-auto text-[11px] text-muted-foreground">
          Up to {INVENTORY_OPTION_MAX_PER_KIND} per list · names up to{" "}
          {INVENTORY_OPTION_LABEL_MAX} characters
        </span>
      </div>
    </div>
  )
}
