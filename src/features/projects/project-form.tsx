import type { Project, ProjectInput } from "@/lib/projects-api"
import {
  OWNERSHIP_LABELS,
  OWNERSHIP_TYPES,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  type OwnershipType,
  type ProjectStatus,
  type ProjectType,
} from "@shared/projects"
import { Field, FieldGrid } from "@/components/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

/**
 * The project form, shared by the create dialog and the Settings tab.
 *
 * Both screens edit the same underlying record, so they edit the same component.
 * Two decisions are worth stating:
 *
 *  * Numbers and dates are held as strings while the user types. A numeric input
 *    that rejects "1" on the way to "120" makes the field feel broken, and a
 *    date field that clears itself mid-edit loses the entry. Both are converted
 *    once, on submit, and the server is the authority on whether the result is
 *    acceptable.
 *
 *  * Radix reserves the empty string for "clear this select", so the optional
 *    picks use an explicit sentinel. "" therefore reliably means "not set" all
 *    the way down to the API, where it becomes null.
 */

/** Radix refuses `value=""`; this stands in for "not set" in optional selects. */
const UNSET = "__unset"

export interface ProjectFormValues {
  name: string
  code: string
  developer: string
  location: string
  status: ProjectStatus
  launchDate: string
  projectType: string
  ownershipType: string
  plannedUnits: string
  description: string
  paymentTerms: string
  handoverDate: string
}

export type ProjectFormErrors = Record<string, string | undefined>

export type ProjectFormProps = {
  values: ProjectFormValues
  onChange: (patch: Partial<ProjectFormValues>) => void
  errors: ProjectFormErrors
  /** Hides the long-form fields the create dialog does not ask for. */
  compact?: boolean
  idPrefix: string
}

/** A brand-new project: planning, nothing stated beyond what was typed. */
export function emptyProjectForm(): ProjectFormValues {
  return {
    name: "",
    code: "",
    developer: "",
    location: "",
    status: "planning",
    launchDate: "",
    projectType: "",
    ownershipType: "",
    plannedUnits: "",
    description: "",
    paymentTerms: "",
    handoverDate: "",
  }
}

/** Seeds the form from a stored project, flattening nulls to blank strings. */
export function projectToForm(project: Project): ProjectFormValues {
  return {
    name: project.name,
    code: project.code ?? "",
    developer: project.developer,
    location: project.location,
    status: project.status,
    launchDate: project.launchDate ?? "",
    projectType: project.projectType ?? "",
    ownershipType: project.ownershipType ?? "",
    plannedUnits:
      project.plannedUnits === null ? "" : String(project.plannedUnits),
    description: project.description ?? "",
    paymentTerms: project.paymentTerms ?? "",
    handoverDate: project.handoverDate ?? "",
  }
}

/**
 * Converts the form into the API shape.
 *
 * Blank optionals become `null` — a deliberate clear — while the four required
 * fields are sent as-is so the server can produce the message. `plannedUnits`
 * becomes NaN for non-numeric text, which fails the server's whole-number check
 * and comes back attached to the field rather than being silently dropped.
 */
export function formToInput(values: ProjectFormValues): ProjectInput {
  const units = values.plannedUnits.trim()

  return {
    name: values.name,
    code: values.code,
    developer: values.developer,
    location: values.location,
    status: values.status,
    launchDate: values.launchDate,
    projectType: values.projectType as ProjectType | null,
    ownershipType: values.ownershipType as OwnershipType | null,
    plannedUnits: units === "" ? null : Number(units),
    description: values.description,
    paymentTerms: values.paymentTerms,
    handoverDate: values.handoverDate,
  }
}

/**
 * Client-side pre-checks for the four required fields.
 *
 * These exist to put the message under the control immediately rather than after
 * a round trip. They do not replace the server's check — the same rules run
 * there — so a value that passes here can still be rejected, and the server's
 * message always wins because it overwrites this map on failure.
 */
export function validateProjectForm(
  values: ProjectFormValues,
): ProjectFormErrors {
  const errors: ProjectFormErrors = {}

  if (values.name.trim() === "") errors.name = "Name the project."
  if (values.developer.trim() === "") errors.developer = "Name the developer."
  if (values.location.trim() === "") errors.location = "Say where it is."

  const units = values.plannedUnits.trim()
  if (units !== "" && !/^\d+$/.test(units))
    errors.plannedUnits = "Use a whole number."

  return errors
}

/** True when two forms describe the same record, so "Save" can stay disabled. */
export function projectFormUnchanged(
  a: ProjectFormValues,
  b: ProjectFormValues,
): boolean {
  return (Object.keys(a) as Array<keyof ProjectFormValues>).every(
    (key) => a[key] === b[key],
  )
}

export function ProjectFormFields({
  values,
  onChange,
  errors,
  compact = false,
  idPrefix,
}: ProjectFormProps) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <FieldGrid>
      <Field
        label="Project name"
        htmlFor={id("name")}
        required
        error={errors.name}
        hint="How your team refers to this development."
      >
        <Input
          value={values.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Marina Gate Residences"
          maxLength={120}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Developer"
        htmlFor={id("developer")}
        required
        error={errors.developer}
      >
        <Input
          value={values.developer}
          onChange={(event) => onChange({ developer: event.target.value })}
          placeholder="Emaar Properties"
          maxLength={120}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Location"
        htmlFor={id("location")}
        required
        error={errors.location}
        className="sm:col-span-2"
      >
        <Input
          value={values.location}
          onChange={(event) => onChange({ location: event.target.value })}
          placeholder="Dubai Marina, Dubai, UAE"
          maxLength={200}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Reference"
        htmlFor={id("code")}
        error={errors.code}
        hint="Optional. Used in correspondence."
      >
        <Input
          value={values.code}
          onChange={(event) => onChange({ code: event.target.value })}
          placeholder="MGR-01"
          maxLength={32}
          autoComplete="off"
        />
      </Field>

      <Field label="Status" htmlFor={id("status")} error={errors.status}>
        <Select
          value={values.status}
          onValueChange={(value) =>
            onChange({ status: value as ProjectStatus })
          }
        >
          <SelectTrigger id={id("status")} aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {PROJECT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Launch date"
        htmlFor={id("launchDate")}
        error={errors.launchDate}
        hint="Leave blank until the date is committed."
      >
        <Input
          type="date"
          value={values.launchDate}
          onChange={(event) => onChange({ launchDate: event.target.value })}
        />
      </Field>

      <Field
        label="Planned units"
        htmlFor={id("plannedUnits")}
        error={errors.plannedUnits}
        hint="The developer's stated plan. Not an inventory count."
      >
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={values.plannedUnits}
          onChange={(event) => onChange({ plannedUnits: event.target.value })}
          placeholder="—"
        />
      </Field>

      <Field
        label="Project type"
        htmlFor={id("projectType")}
        error={errors.projectType}
      >
        <Select
          value={values.projectType === "" ? UNSET : values.projectType}
          onValueChange={(value) =>
            onChange({
              projectType: value === UNSET ? "" : value as ProjectType,
            })
          }
        >
          <SelectTrigger id={id("projectType")} aria-label="Project type">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Not set</SelectItem>
            {PROJECT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {PROJECT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Ownership"
        htmlFor={id("ownershipType")}
        error={errors.ownershipType}
      >
        <Select
          value={values.ownershipType === "" ? UNSET : values.ownershipType}
          onValueChange={(value) =>
            onChange({
              ownershipType: value === UNSET ? "" : value as OwnershipType,
            })
          }
        >
          <SelectTrigger id={id("ownershipType")} aria-label="Ownership">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Not set</SelectItem>
            {OWNERSHIP_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {OWNERSHIP_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Handover date"
        htmlFor={id("handoverDate")}
        error={errors.handoverDate}
        className="sm:col-span-2"
      >
        <Input
          type="date"
          value={values.handoverDate}
          onChange={(event) => onChange({ handoverDate: event.target.value })}
        />
      </Field>

      {/* Commercial terms are a Settings-tab concern; the create dialog asks
          only what is needed to stand the project up. */}
      {!compact && (
        <Field
          label="Payment terms"
          htmlFor={id("paymentTerms")}
          error={errors.paymentTerms}
          hint="Shown to the sales team. Not shown to buyers."
        >
          <Input
            value={values.paymentTerms}
            onChange={(event) => onChange({ paymentTerms: event.target.value })}
            placeholder="20% on booking, monthly over 24 months"
            maxLength={500}
          />
        </Field>
      )}

      <Field
        label="Description"
        htmlFor={id("description")}
        error={errors.description}
        className={compact ? "sm:col-span-2" : undefined}
      >
        <Textarea
          value={values.description}
          onChange={(event) => onChange({ description: event.target.value })}
          rows={compact ? 2 : 3}
          maxLength={2000}
          placeholder="What this development is, and who it is for."
        />
      </Field>
    </FieldGrid>
  )
}
