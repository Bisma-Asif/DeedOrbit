import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react"

import { Building2, Upload, X } from "lucide-react"

import {
  CURRENCIES,
  EMAIL_PATTERN,
  LOGO_MAX_BYTES,
  MONTHS,
  TIME_ZONES,
  WEEKDAYS,
  formatWorkingDays,
  isTimeZone,
  normalizeWorkingDays,
} from "@shared/organization"

import { ApiError } from "@/lib/api"

import { organizationApi } from "@/lib/organization-api"

import type { OrganizationSettings } from "@/lib/organization-api"

import { cn } from "@/lib/utils"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Checkbox } from "@/components/ui/checkbox"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Field, FieldGrid } from "@/components/field"

import { fieldError, useSave } from "./use-save"

/**
 * The values the form edits.
 *
 * Nullable server columns are held as strings here and converted on submit, so
 * a control never has to deal with `null`. The conversion is one-directional
 * and explicit in `toInput` rather than spread across each handler.
 */
interface ProfileFormValues {
  name: string
  legalName: string
  registrationNumber: string
  taxId: string
  addressLine1: string
  addressLine2: string
  city: string
  stateRegion: string
  postalCode: string
  countryCode: string
  phone: string
  collectionsEmail: string
  currency: string
  timezone: string
  fiscalYearStartMonth: string
  workingDays: number[]
}

type EditableKey = keyof ProfileFormValues

function text(value: string | null): string {
  return value ?? ""
}

/** A blank becomes null so the server clears the column instead of storing "". */
function optional(value: string): string | null {
  const trimmed = value.trim()

  return trimmed === "" ? null : trimmed
}

function toFormValues(settings: OrganizationSettings): ProfileFormValues {
  return {
    name: settings.name,
    legalName: text(settings.legalName),
    registrationNumber: text(settings.registrationNumber),
    taxId: text(settings.taxId),
    addressLine1: text(settings.addressLine1),
    addressLine2: text(settings.addressLine2),
    city: text(settings.city),
    stateRegion: text(settings.stateRegion),
    postalCode: text(settings.postalCode),
    countryCode: settings.countryCode ?? "",
    phone: text(settings.phone),
    collectionsEmail: text(settings.collectionsEmail),
    currency: settings.currency,
    timezone: settings.timezone,
    fiscalYearStartMonth: String(settings.fiscalYearStartMonth),
    workingDays: settings.workingDays,
  }
}

export function ProfileForm({
  settings,

  canEdit,

  onSaved,
}: {
  settings: OrganizationSettings
  canEdit: boolean
  onSaved: (next: OrganizationSettings) => void
}) {
  const [values, setValues] = useState<ProfileFormValues>(() =>
    toFormValues(settings),
  )

  const save = useSave()

  const logoSave = useSave()

  // Re-seed when a different workspace's settings arrive, but not on every
  // render: without this guard, each keystroke that round-tripped would reset
  // the field the user was typing in.
  useEffect(() => {
    setValues(toFormValues(settings))
  }, [settings])

  const set = useCallback(
    <K extends EditableKey>(key: K, value: ProfileFormValues[K]) => {
      save.clear()

      setValues((current) => ({ ...current, [key]: value }))
    },
    [save.clear],
  )

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(toFormValues(settings)),

    [values, settings],
  )

  const workingDaysInvalid = normalizeWorkingDays(values.workingDays) === null

  const workingDaysSummary = useMemo(
    () => formatWorkingDays(values.workingDays),

    [values.workingDays],
  )

  const timezoneMissing = !isTimeZone(values.timezone)

  /**
   * The same pattern the server applies, so the message matches the one a
   * round-trip would return. Only a value the user actually typed is judged:
   * blank means "clear the column" and is always allowed.
   */
  const collectionsEmailError =
    values.collectionsEmail.trim() !== "" &&
    !EMAIL_PATTERN.test(values.collectionsEmail.trim())
      ? "Enter a valid collections email, or leave blank."
      : undefined

  const canSubmit =
    canEdit &&
    dirty &&
    !save.saving &&
    !workingDaysInvalid &&
    !timezoneMissing &&
    !collectionsEmailError

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) return

    void save.run(async () => {
      const result = await organizationApi.updateProfile({
        name: values.name.trim(),
        legalName: optional(values.legalName),
        registrationNumber: optional(values.registrationNumber),
        taxId: optional(values.taxId),
        addressLine1: optional(values.addressLine1),
        addressLine2: optional(values.addressLine2),
        city: optional(values.city),
        stateRegion: optional(values.stateRegion),
        postalCode: optional(values.postalCode),
        countryCode: optional(values.countryCode),
        phone: optional(values.phone),
        collectionsEmail: optional(values.collectionsEmail),
        currency: values.currency,
        timezone: values.timezone,
        fiscalYearStartMonth: Number(values.fiscalYearStartMonth),
        workingDays: values.workingDays,
      })

      onSaved(result.settings)
    })
  }

  function toggleWorkingDay(day: number, on: boolean) {
    const next = on
      ? [...values.workingDays, day]
      : values.workingDays.filter((d) => d !== day)

    set("workingDays", normalizeWorkingDays(next) ?? values.workingDays)
  }

  return (
    // `noValidate` because the native bubble is not an acceptable error surface
    // here: it appears once, cannot be styled to match the rest of the form,
    // and it silently blocks submit so the Field error never renders. The
    // shared patterns below own the message instead, exactly as the server
    // does.
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {!canEdit && (
        <Alert>
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Your role can view organization settings but not change them.
          </AlertDescription>
        </Alert>
      )}

      {save.error && (
        <Alert variant="danger">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 size={15} className="text-muted-foreground" />
            Registered details
          </CardTitle>
          <CardDescription>
            The legal identity this workspace issues documents under. The
            trading name is what members see; the legal name is what appears on
            invoices and contracts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGrid>
            <Field
              label="Trading name"
              htmlFor="org-name"
              required
              error={fieldError(save, "name")}
              hint="Shown in the sidebar and on statements."
            >
              <Input
                id="org-name"
                value={values.name}
                disabled={!canEdit}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>

            <Field
              label="Registered legal name"
              htmlFor="org-legal-name"
              required
              error={fieldError(save, "legalName")}
              hint="Leave blank only if it is the same as the trading name."
            >
              <Input
                id="org-legal-name"
                value={values.legalName}
                disabled={!canEdit}
                onChange={(e) => set("legalName", e.target.value)}
              />
            </Field>

            <Field
              label="Registration number"
              htmlFor="org-registration"
              error={fieldError(save, "registrationNumber")}
              hint="6-20 letters, digits, or hyphens."
            >
              <Input
                id="org-registration"
                value={values.registrationNumber}
                disabled={!canEdit}
                onChange={(e) => set("registrationNumber", e.target.value)}
              />
            </Field>

            <Field
              label="Tax ID"
              htmlFor="org-tax-id"
              error={fieldError(save, "taxId")}
              hint="Optional. 4-20 letters, digits, or hyphens."
            >
              <Input
                id="org-tax-id"
                value={values.taxId}
                disabled={!canEdit}
                onChange={(e) => set("taxId", e.target.value)}
              />
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Address and contact</CardTitle>
          <CardDescription>
            Where correspondence is delivered, and who to contact about payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGrid>
            <Field
              label="Address line 1"
              htmlFor="org-address-1"
              error={fieldError(save, "addressLine1")}
            >
              <Input
                id="org-address-1"
                value={values.addressLine1}
                disabled={!canEdit}
                onChange={(e) => set("addressLine1", e.target.value)}
              />
            </Field>

            <Field
              label="Address line 2"
              htmlFor="org-address-2"
              error={fieldError(save, "addressLine2")}
            >
              <Input
                id="org-address-2"
                value={values.addressLine2}
                disabled={!canEdit}
                onChange={(e) => set("addressLine2", e.target.value)}
              />
            </Field>

            <Field
              label="City"
              htmlFor="org-city"
              error={fieldError(save, "city")}
            >
              <Input
                id="org-city"
                value={values.city}
                disabled={!canEdit}
                onChange={(e) => set("city", e.target.value)}
              />
            </Field>

            <Field
              label="State or region"
              htmlFor="org-region"
              error={fieldError(save, "stateRegion")}
            >
              <Input
                id="org-region"
                value={values.stateRegion}
                disabled={!canEdit}
                onChange={(e) => set("stateRegion", e.target.value)}
              />
            </Field>

            <Field
              label="Postal code"
              htmlFor="org-postal"
              error={fieldError(save, "postalCode")}
            >
              <Input
                id="org-postal"
                value={values.postalCode}
                disabled={!canEdit}
                onChange={(e) => set("postalCode", e.target.value)}
              />
            </Field>

            <Field
              label="Country code"
              htmlFor="org-country"
              error={fieldError(save, "countryCode")}
              hint="Two-letter ISO code, for example AE."
            >
              <Input
                id="org-country"
                value={values.countryCode}
                disabled={!canEdit}
                maxLength={2}
                onChange={(e) =>
                  set("countryCode", e.target.value.toUpperCase())
                }
              />
            </Field>

            <Field
              label="Phone"
              htmlFor="org-phone"
              error={fieldError(save, "phone")}
            >
              <Input
                id="org-phone"
                value={values.phone}
                disabled={!canEdit}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>

            <Field
              label="Collections email"
              htmlFor="org-collections-email"
              error={
                collectionsEmailError ?? fieldError(save, "collectionsEmail")
              }
              hint="Payment reminders go here, not to a member's inbox."
            >
              <Input
                id="org-collections-email"
                type="email"
                value={values.collectionsEmail}
                disabled={!canEdit}
                onChange={(e) => set("collectionsEmail", e.target.value)}
              />
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regional</CardTitle>
          <CardDescription>
            Currency, time zone, and the financial year this workspace reports
            against.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGrid>
            <Field
              label="Base currency"
              htmlFor="org-currency"
              error={fieldError(save, "currency")}
            >
              <Select
                value={values.currency}
                disabled={!canEdit}
                onValueChange={(v) => set("currency", v)}
              >
                <SelectTrigger id="org-currency">
                  <SelectValue placeholder="Choose a currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} - {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Time zone"
              htmlFor="org-timezone"
              error={
                timezoneMissing
                  ? "Choose a supported time zone."
                  : fieldError(save, "timezone")
              }
            >
              <Select
                value={values.timezone}
                disabled={!canEdit}
                onValueChange={(v) => set("timezone", v)}
              >
                <SelectTrigger id="org-timezone">
                  <SelectValue placeholder="Choose a time zone" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_ZONES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Financial year starts"
              htmlFor="org-fiscal-month"
              error={fieldError(save, "fiscalYearStartMonth")}
              hint={
                values.fiscalYearStartMonth
                  ? `Resets document counters each ${MONTHS[Number(values.fiscalYearStartMonth) - 1]}.`
                  : undefined
              }
            >
              <Select
                value={values.fiscalYearStartMonth}
                disabled={!canEdit}
                onValueChange={(v) => set("fiscalYearStartMonth", v)}
              >
                <SelectTrigger id="org-fiscal-month">
                  <SelectValue placeholder="Choose a month" />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((month, index) => (
                    <SelectItem key={month} value={String(index + 1)}>
                      {month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium text-foreground">
              Working days
            </legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2.5">
              {WEEKDAYS.map((day) => {
                const checked = values.workingDays.includes(day.value)

                return (
                  <label
                    key={day.value}
                    className="flex items-center gap-2 text-[13px]"
                  >
                    <Checkbox
                      id={`org-day-${day.value}`}
                      checked={checked}
                      disabled={!canEdit}
                      onCheckedChange={(on) =>
                        toggleWorkingDay(day.value, on === true)
                      }
                    />
                    {day.long}
                  </label>
                )
              })}
            </div>
            <p
              className={cn(
                "text-[11.5px] leading-4",
                workingDaysInvalid ? "text-danger" : "text-muted-foreground",
              )}
              role={workingDaysInvalid ? "alert" : undefined}
            >
              {workingDaysInvalid
                ? "Select at least one working day."
                : `Currently ${workingDaysSummary}.`}
            </p>
          </fieldset>
        </CardContent>
      </Card>

      <LogoSection
        settings={settings}
        canEdit={canEdit}
        save={logoSave}
        onSaved={onSaved}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {save.saving
            ? "Saving"
            : save.saved
              ? "Saved"
              : dirty
                ? "Save changes"
                : "No changes"}
        </Button>
        {dirty && !save.saving && (
          <span className="text-[11.5px] text-muted-foreground">
            Unsaved changes
          </span>
        )}
      </div>
    </form>
  )
}

function LogoSection({
  settings,
  canEdit,
  save,
  onSaved,
}: {
  settings: OrganizationSettings
  canEdit: boolean
  save: ReturnType<typeof useSave>
  onSaved: (next: OrganizationSettings) => void
}) {
  const [pending, setPending] = useState<{
    dataUrl: string
    name: string
  } | null>(null)

  async function choose(file: File) {
    if (!file.type.startsWith("image/")) {
      save.run(async () => {
        throw new ApiError(0, {
          code: "unsupported_image",
          message: "Choose a PNG, JPEG, or WebP image.",
        })
      })

      return
    }

    if (file.size > LOGO_MAX_BYTES) {
      save.run(async () => {
        throw new ApiError(0, {
          code: "logo_too_large",
          message: `That image is ${Math.round(file.size / 1024)} KB. The limit is ${Math.round(LOGO_MAX_BYTES / 1024)} KB.`,
        })
      })

      return
    }

    const dataUrl = await readAsDataUrl(file)

    setPending({ dataUrl, name: file.name })
  }

  function discard() {
    setPending(null)

    save.clear()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>
          Appears on invoices, statements, and the sidebar. PNG, JPEG, or WebP,
          up to {Math.round(LOGO_MAX_BYTES / 1024)} KB.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {save.error && (
          <Alert variant="danger">
            <AlertTitle>Could not update the logo</AlertTitle>
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-[18px] font-semibold text-muted-foreground">
            {pending ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pending.dataUrl}
                alt=""
                className="size-full object-contain"
              />
            ) : settings.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logo.dataUrl}
                alt="Current logo"
                className="size-full object-contain"
              />
            ) : (
              (settings.logoInitials ?? "--")
            )}
          </span>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <label className="inline-flex">
                  <input
                    type="file"
                    className="sr-only"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0]

                      if (file) void choose(file)

                      e.target.value = ""
                    }}
                  />
                  <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-foreground hover:bg-muted">
                    <Upload size={13} />
                    {pending ? "Replace" : "Upload"}
                  </span>
                </label>
              )}

              {pending && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={discard}
                  disabled={save.saving}
                >
                  <X size={13} />
                  Discard
                </Button>
              )}

              {canEdit && settings.logo && !pending && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={save.saving}
                  onClick={() =>
                    void save.run(async () => {
                      onSaved((await organizationApi.removeLogo()).settings)
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </div>

            <p className="text-[11.5px] text-muted-foreground">
              {pending
                ? `${pending.name} ready to upload.`
                : settings.logo?.updatedAt
                  ? `Uploaded ${new Date(settings.logo.updatedAt).toLocaleDateString()}.`
                  : "No logo uploaded. The workspace initials are used instead."}
            </p>
          </div>
        </div>

        {canEdit && pending && (
          <div>
            <Button
              size="sm"
              disabled={save.saving}
              onClick={() =>
                void save.run(async () => {
                  onSaved(
                    (await organizationApi.uploadLogo(pending.dataUrl))
                      .settings,
                  )

                  setPending(null)
                })
              }
            >
              {save.saving ? "Uploading" : "Save logo"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result))

    reader.onerror = () =>
      reject(
        new ApiError(0, {
          code: "read_failed",
          message: "That file could not be read.",
        }),
      )

    reader.readAsDataURL(file)
  })
}
