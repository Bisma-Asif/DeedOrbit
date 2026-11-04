import { useState } from "react"

import { ScanLine } from "lucide-react"

import { Field, FieldGrid } from "@/components/field"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"

import { Label } from "@/components/ui/label"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Switch } from "@/components/ui/switch"

import { Textarea } from "@/components/ui/textarea"

import type { CustomerInput } from "@/lib/leads-api"

import {
  CUSTOMER_FIELD_SECTION_LABELS,
  CUSTOMER_GENDER_LABELS,
  CUSTOMER_GENDERS,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_HINTS,
  CUSTOMER_TYPE_LABELS,
  type CustomerEntryFieldView,
  type CustomerEntryInput,
  type CustomerFieldSection,
  copyCurrentAddressToPermanent,
  currentAddressMatchesPermanent,
  customerDetailFieldsFor,
  customerFieldExpectedFor,
  customerFieldsInSection,
  customerMissingFieldLabels,
  isCustomerType,
} from "@shared/customer-entry"

/**
 * The customer form, built from the shared field list.
 *
 * Nothing is hard-coded here that `shared/customer-entry.ts` already decides: the fields,
 * their order, their lengths, their closed lists, which of them the booking file expects and
 * which of them a company cannot answer at all. A form that kept its own list is a form that
 * can offer a field the API throws away, and on a desk that types from paper, that is a
 * record with a value nobody can see afterwards.
 *
 * Two things it deliberately does not do. It never fills a value the officer did not type —
 * no defaulting a country, no completing a phone number, no date guessed from a CNIC — and
 * it never claims a file is complete: what is still absent is listed in a plain, uncoloured
 * strip, because "nothing has decided this record is finished on your behalf" is the whole
 * point of the screen.
 */

/** Radix refuses `value=""`; this stands in for "not set" in the optional selects. */
const UNSET = "__unset"

/** Sections in the order the paper form asks for them, which is the field list's order. */
const FORM_SECTIONS: CustomerFieldSection[] = [
  "personal",

  "contact",

  "current_address",

  "permanent_address",

  "type",

  "identity_document",

  "nominee",

  "next_of_kin",

  "notes",
]

/** Fields that read better full-width than in a two-column grid. */
const FULL_WIDTH_FIELDS: string[] = [
  "notes",

  "addressLine1",

  "addressLine2",

  "permanentAddressLine1",

  "permanentAddressLine2",
]

export interface CustomerProfileFormProps {
  values: CustomerInput

  errors: Record<string, string>

  onChange: (patch: Partial<CustomerInput>) => void

  idPrefix?: string

  disabled?: boolean

  /**
   * Whether the tenant allows a "scan from document" control at all. No document reader is
   * wired to this product, so the control says so and fills nothing either way — the setting
   * only decides whether the panel appears.
   */
  ocrCaptureEnabled?: boolean

  /** Show what the booking file still needs, live, as the officer types. */
  showMissing?: boolean
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="w-full border-b border-border pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {title}
    </h3>
  )
}

/** The choices for one closed list, as the label the desk reads. */
function selectChoices(
  list: "customer_type" | "gender",
): Array<{
  key: string
  label: string
}> {
  if (list === "customer_type") {
    return CUSTOMER_TYPES.map((value) => ({
      key: value,

      label: CUSTOMER_TYPE_LABELS[value],
    }))
  }

  return CUSTOMER_GENDERS.map((value) => ({
    key: value,

    label: CUSTOMER_GENDER_LABELS[value],
  }))
}

export function CustomerProfileForm({
  values,
  errors,
  onChange,
  idPrefix = "customer",
  disabled = false,
  ocrCaptureEnabled = false,
  showMissing = true,
}: CustomerProfileFormProps) {
  // Derived once, then owned: a tick that recomputed on every keystroke would switch itself
  // off the moment the officer typed into the current address, which is exactly when it is
  // meant to keep following. Toggling it off leaves the copied values where they are, so a
  // mis-click costs nothing but the tick.
  const [sameAsCurrent, setSameAsCurrent] = useState(() =>
    currentAddressMatchesPermanent(values),
  )

  const rules = customerDetailFieldsFor(values.customerType)

  const visible = new Set<string>(rules.visible)

  const missing = showMissing ? customerMissingFieldLabels(values) : []

  function emit(patch: Partial<CustomerInput>) {
    if (!sameAsCurrent) {
      onChange(patch)

      return
    }

    const merged: CustomerEntryInput = { ...values, ...patch }

    onChange(copyCurrentAddressToPermanent(merged))
  }

  function toggleSameAsCurrent(on: boolean) {
    setSameAsCurrent(on)

    if (on) onChange(copyCurrentAddressToPermanent(values))
  }

  function renderField(field: CustomerEntryFieldView) {
    const key = field.key

    const id = `${idPrefix}-${key}`

    // A field this type cannot answer is hidden — unless the record already carries a
    // value, in which case hiding it would show a saved record as an empty one and let a
    // save write a blank over it.
    if (!visible.has(key) && values[key] === "") return null

    const expectation = customerFieldExpectedFor(key, values.customerType)

    const mirrored = field.section === "permanent_address" && sameAsCurrent

    const locked = disabled || mirrored

    const value = values[key]

    const hint =
      expectation === "expected"
        ? "Expected on this customer type's booking file."
        : expectation === "advised"
          ? "Advised for this customer type."
          : field.hint

    const className = FULL_WIDTH_FIELDS.includes(key)
      ? "sm:col-span-2"
      : undefined

    if (field.type === "select" && field.options !== undefined) {
      return (
        <Field
          key={key}
          label={field.label}
          htmlFor={id}
          required={field.required === true}
          hint={hint}
          error={errors[key]}
          className={className}
        >
          <Select
            value={value === "" ? UNSET : value}
            onValueChange={(next) =>
              emit({ [key]: next === UNSET ? "" : next })
            }
            disabled={locked}
          >
            <SelectTrigger id={id} aria-label={field.label}>
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Not set</SelectItem>
              {selectChoices(field.options).map((choice) => (
                <SelectItem key={choice.key} value={choice.key}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )
    }

    if (field.type === "textarea") {
      return (
        <Field
          key={key}
          label={field.label}
          htmlFor={id}
          required={field.required === true}
          hint={hint}
          error={errors[key]}
          className={className}
        >
          <Textarea
            value={value}
            rows={4}
            maxLength={field.max}
            disabled={locked}
            onChange={(event) => emit({ [key]: event.target.value })}
          />
        </Field>
      )
    }

    return (
      <Field
        key={key}
        label={field.label}
        htmlFor={id}
        required={field.required === true}
        hint={hint}
        error={errors[key]}
        className={className}
      >
        <Input
          type={field.type === "date" ? "date" : field.type}
          value={value}
          maxLength={field.max}
          disabled={locked}
          inputMode={field.type === "tel" ? "tel" : undefined}
          autoComplete={
            key === "fullName"
              ? "name"
              : key === "phone"
                ? "tel"
                : key === "email"
                  ? "email"
                  : "off"
          }
          onChange={(event) => emit({ [key]: event.target.value })}
        />
      </Field>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {FORM_SECTIONS.map((section) => {
        const fields = customerFieldsInSection(section)

        const shown = fields.map(renderField).filter(Boolean)

        if (shown.length === 0) return null

        return (
          <section key={section} className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <SectionHeading title={CUSTOMER_FIELD_SECTION_LABELS[section]} />
              {section === "permanent_address" && (
                <div className="flex shrink-0 items-center gap-2">
                  <Label
                    htmlFor={`${idPrefix}-same-as-current`}
                    className="text-[11.5px] font-normal text-muted-foreground"
                  >
                    Permanent same as current
                  </Label>
                  <Switch
                    id={`${idPrefix}-same-as-current`}
                    checked={sameAsCurrent}
                    disabled={disabled}
                    onCheckedChange={(next) => toggleSameAsCurrent(next)}
                  />
                </div>
              )}
            </div>
            {section === "permanent_address" && sameAsCurrent && (
              <p className="text-[11.5px] leading-4 text-muted-foreground">
                Copied from the current address. Type over any line to keep the
                two different.
              </p>
            )}
            <FieldGrid>{shown}</FieldGrid>
          </section>
        )
      })}

      {isCustomerType(values.customerType) &&
        values.customerType !== "individual" && (
          <Alert variant="neutral">
            <AlertDescription>
              {CUSTOMER_TYPE_HINTS[values.customerType]}
            </AlertDescription>
          </Alert>
        )}

      {ocrCaptureEnabled && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <Button variant="outline" size="sm" className="w-fit" disabled>
            <ScanLine size={13} />
            Scan from document
          </Button>
          <p className="text-[11.5px] leading-4 text-muted-foreground">
            Nothing is filled by a scan. No document reader is connected to this
            workspace, so every value has to be typed from the paper in front of
            you — the setting only decides whether this control is offered.
          </p>
        </div>
      )}

      {missing.length > 0 && (
        <Alert variant="neutral">
          <AlertTitle>Still missing for a complete booking file</AlertTitle>
          <AlertDescription asChild>
            <div className="mt-1 flex flex-wrap gap-1">
              {missing.map((label) => (
                <Badge key={label} variant="outline">
                  {label}
                </Badge>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {missing.length === 0 && showMissing && (
        <p className="text-[11.5px] leading-4 text-muted-foreground">
          Every field this customer type is expected to carry has a value.
          Nothing here confirms the record is correct — that stays with whoever
          read the paper.
        </p>
      )}
    </div>
  )
}
