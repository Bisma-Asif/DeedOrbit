import { useState } from "react"

import { Building2, MapPin, Pencil, Plus, Star } from "lucide-react"

import { BRANCH_CODE_PATTERN } from "@shared/organization"

import { organizationApi } from "@/lib/organization-api"

import type { Branch, BranchInput } from "@/lib/organization-api"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Input } from "@/components/ui/input"

import { Label } from "@/components/ui/label"

import { Separator } from "@/components/ui/separator"

import { Switch } from "@/components/ui/switch"

import { Field, FieldGrid } from "@/components/field"

import { EmptyState } from "@/components/empty-state"

import { fieldError, useSave } from "./use-save"

interface BranchFormValues {
  name: string
  code: string
  addressLine1: string
  addressLine2: string
  city: string
  stateRegion: string
  postalCode: string
  countryCode: string
  phone: string
  email: string
  isHeadquarters: boolean
}

const EMPTY: BranchFormValues = {
  name: "",
  code: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateRegion: "",
  postalCode: "",
  countryCode: "",
  phone: "",
  email: "",
  isHeadquarters: false,
}

function toForm(branch: Branch | null): BranchFormValues {
  if (!branch) return EMPTY

  return {
    name: branch.name,
    code: branch.code ?? "",
    addressLine1: branch.addressLine1 ?? "",
    addressLine2: branch.addressLine2 ?? "",
    city: branch.city ?? "",
    stateRegion: branch.stateRegion ?? "",
    postalCode: branch.postalCode ?? "",
    countryCode: branch.countryCode ?? "",
    phone: branch.phone ?? "",
    email: branch.email ?? "",
    isHeadquarters: branch.isHeadquarters,
  }
}

function optional(value: string): string | null {
  const trimmed = value.trim()

  return trimmed === "" ? null : trimmed
}

/**
 * The code is stored uppercase and the server compares case-insensitively, so
 * it is uppercased here too. Otherwise "dxb" would look accepted in the form
 * and then be rejected as a duplicate of "DXB".
 */
function toInput(values: BranchFormValues): BranchInput {
  return {
    name: values.name.trim(),
    code: values.code.trim() === "" ? null : values.code.trim().toUpperCase(),
    addressLine1: optional(values.addressLine1),
    addressLine2: optional(values.addressLine2),
    city: optional(values.city),
    stateRegion: optional(values.stateRegion),
    postalCode: optional(values.postalCode),
    countryCode: optional(values.countryCode),
    phone: optional(values.phone),
    email: optional(values.email),
    isHeadquarters: values.isHeadquarters,
  }
}

function addressOf(branch: Branch): string {
  const parts = [branch.addressLine1, branch.city, branch.countryCode].filter(
    (part): part is string => Boolean(part),
  )

  return parts.length > 0 ? parts.join(", ") : "No address recorded"
}

export function OfficesPanel({
  branches,

  canEdit,

  onChanged,
}: {
  branches: Branch[]
  canEdit: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<Branch | null>(null)

  const [creating, setCreating] = useState(false)

  const archive = useSave()

  // Guards the confirm dialog: a branch can be archived by another member
  // between opening it and confirming.
  const [archiving, setArchiving] = useState<Branch | null>(null)

  if (branches.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No offices yet"
        description="Add the first office. It becomes the headquarters automatically, which is where documents are issued from."
        action={
          canEdit ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} />
              Add office
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-muted-foreground">
            {branches.length === 1 ? "1 office" : `${branches.length} offices`}
          </p>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            Add office
          </Button>
        </div>
      )}

      {archive.error && (
        <Alert variant="danger">
          <AlertTitle>Could not archive the office</AlertTitle>
          <AlertDescription>{archive.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {branches.map((branch) => (
          <Card key={branch.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <CardTitle className="flex items-center gap-2">
                    <span className="truncate">{branch.name}</span>
                    {branch.isHeadquarters && (
                      <Badge variant="success" className="shrink-0">
                        <Star size={11} />
                        Headquarters
                      </Badge>
                    )}
                    {branch.status !== "active" && (
                      <Badge variant="pending" className="shrink-0">
                        Archived
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1.5">
                    <MapPin size={12} className="shrink-0" />
                    <span className="truncate">{addressOf(branch)}</span>
                  </CardDescription>
                </div>

                {branch.code && (
                  <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {branch.code}
                  </span>
                )}
              </div>
            </CardHeader>

            {canEdit && (
              <CardContent className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(branch)}
                >
                  <Pencil size={13} />
                  Edit
                </Button>
                {branch.status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setArchiving(branch)}
                  >
                    Archive
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {(creating || editing) && (
        <BranchDialog
          branch={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            onChanged()
          }}
        />
      )}

      {archiving && (
        <ArchiveDialog
          branch={archiving}
          onClose={() => setArchiving(null)}
          onArchived={() => {
            setArchiving(null)
            archive.clear()
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function BranchDialog({
  branch,

  onClose,

  onSaved,
}: {
  branch: Branch | null
  onClose: () => void
  onSaved: () => void
}) {
  const [values, setValues] = useState<BranchFormValues>(() => toForm(branch))

  const save = useSave()

  const editing = branch !== null

  const codeInvalid =
    values.code.trim() !== "" && !BRANCH_CODE_PATTERN.test(values.code.trim())

  const canSubmit =
    values.name.trim().length >= 2 && !save.saving && !codeInvalid

  function set<K extends keyof BranchFormValues>(
    key: K,
    value: BranchFormValues[K],
  ) {
    save.clear()

    setValues((current) => ({ ...current, [key]: value }))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit office" : "Add office"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changes apply immediately across documents raised for this office."
              : "The first office a workspace has becomes its headquarters."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-4">
            {save.error && (
              <Alert variant="danger">
                <AlertTitle>Could not save the office</AlertTitle>
                <AlertDescription>{save.error}</AlertDescription>
              </Alert>
            )}

            <FieldGrid>
              <Field
                label="Office name"
                htmlFor="branch-name"
                required
                error={fieldError(save, "name")}
              >
                <Input
                  id="branch-name"
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </Field>

              <Field
                label="Code"
                htmlFor="branch-code"
                error={
                  codeInvalid
                    ? "Use 2-8 uppercase letters, digits, or hyphens."
                    : fieldError(save, "code")
                }
                hint="Short reference used on documents. Optional."
              >
                <Input
                  id="branch-code"
                  value={values.code}
                  maxLength={8}
                  onChange={(e) => set("code", e.target.value.toUpperCase())}
                />
              </Field>

              <Field
                label="Address line 1"
                htmlFor="branch-address-1"
                error={fieldError(save, "addressLine1")}
                className="sm:col-span-2"
              >
                <Input
                  id="branch-address-1"
                  value={values.addressLine1}
                  onChange={(e) => set("addressLine1", e.target.value)}
                />
              </Field>

              <Field
                label="Address line 2"
                htmlFor="branch-address-2"
                error={fieldError(save, "addressLine2")}
                className="sm:col-span-2"
              >
                <Input
                  id="branch-address-2"
                  value={values.addressLine2}
                  onChange={(e) => set("addressLine2", e.target.value)}
                />
              </Field>

              <Field
                label="City"
                htmlFor="branch-city"
                error={fieldError(save, "city")}
              >
                <Input
                  id="branch-city"
                  value={values.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              </Field>

              <Field
                label="State or region"
                htmlFor="branch-region"
                error={fieldError(save, "stateRegion")}
              >
                <Input
                  id="branch-region"
                  value={values.stateRegion}
                  onChange={(e) => set("stateRegion", e.target.value)}
                />
              </Field>

              <Field
                label="Postal code"
                htmlFor="branch-postal"
                error={fieldError(save, "postalCode")}
              >
                <Input
                  id="branch-postal"
                  value={values.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                />
              </Field>

              <Field
                label="Country code"
                htmlFor="branch-country"
                error={fieldError(save, "countryCode")}
                hint="Two-letter ISO code."
              >
                <Input
                  id="branch-country"
                  value={values.countryCode}
                  maxLength={2}
                  onChange={(e) =>
                    set("countryCode", e.target.value.toUpperCase())
                  }
                />
              </Field>

              <Field
                label="Phone"
                htmlFor="branch-phone"
                error={fieldError(save, "phone")}
              >
                <Input
                  id="branch-phone"
                  value={values.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </Field>

              <Field
                label="Email"
                htmlFor="branch-email"
                error={fieldError(save, "email")}
              >
                <Input
                  id="branch-email"
                  type="email"
                  value={values.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </Field>
            </FieldGrid>

            <Separator />

            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="branch-hq">Headquarters office</Label>
                <p className="text-[11.5px] leading-4 text-muted-foreground">
                  Documents are raised from the headquarters. Promoting another
                  office demotes this one in the same save.
                </p>
              </div>
              <Switch
                id="branch-hq"
                checked={values.isHeadquarters}
                disabled={
                  branch?.isHeadquarters === true ||
                  (branch !== null && branch.status !== "active")
                }
                onCheckedChange={(on) => set("isHeadquarters", on === true)}
              />
            </div>

            {branch?.isHeadquarters === true && (
              <p className="text-[11.5px] text-muted-foreground">
                This office is already the headquarters. Promote another office
                to change it.
              </p>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              void save.run(async () => {
                if (branch) {
                  await organizationApi.updateBranch(branch.id, toInput(values))
                } else {
                  await organizationApi.createBranch(toInput(values))
                }

                onSaved()
              })
            }
          >
            {save.saving
              ? "Saving"
              : save.saved
                ? "Saved"
                : editing
                  ? "Save changes"
                  : "Add office"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveDialog({
  branch,

  onClose,

  onArchived,
}: {
  branch: Branch
  onClose: () => void
  onArchived: () => void
}) {
  const save = useSave()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {branch.name}?</DialogTitle>
          <DialogDescription>
            The office stops appearing on new documents. Existing documents keep
            the office they were raised from. Archiving is not reversible from
            this screen.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {save.error && (
            <Alert variant="danger">
              <AlertTitle>Could not archive the office</AlertTitle>
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}

          {branch.isHeadquarters && (
            <Alert variant="pending">
              <AlertTitle>This is the headquarters office</AlertTitle>
              <AlertDescription>
                Another active office will be promoted to headquarters in the
                same save, so the workspace is never left without one.
              </AlertDescription>
            </Alert>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.saving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={save.saving}
            onClick={() =>
              void save.run(async () => {
                await organizationApi.archiveBranch(branch.id)

                onArchived()
              })
            }
          >
            {save.saving ? "Archiving" : "Archive office"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
