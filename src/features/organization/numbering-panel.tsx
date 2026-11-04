import { useEffect, useMemo, useState } from "react"

import { Hash, RotateCcw, Ticket } from "lucide-react"

import {
  NUMBER_KIND_LABELS,
  formatDocumentNumber,
  isValidPadding,
  isValidPrefix,
} from "@shared/organization"

import { organizationApi } from "@/lib/organization-api"

import type { NumberFormat, NumberFormatInput } from "@/lib/organization-api"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

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

import { Separator } from "@/components/ui/separator"

import { Switch } from "@/components/ui/switch"

import { Field } from "@/components/field"

import { fieldError, useSave } from "./use-save"

interface FormatDraft {
  prefix: string
  padding: string
  resetYearly: boolean
}

function toDraft(format: NumberFormat): FormatDraft {
  return {
    prefix: format.prefix,
    padding: String(format.padding),
    resetYearly: format.resetYearly,
  }
}

function draftValid(draft: FormatDraft): boolean {
  return (
    isValidPrefix(draft.prefix.trim()) && isValidPadding(Number(draft.padding))
  )
}

/**
 * Document numbering.
 *
 * The counter itself is never editable here. `nextValue` moves only when a
 * document is issued or when someone uses the explicit, audited reset - hand-
 * editing a live counter is how two documents end up sharing a number.
 */
interface IssuedNumberPreview {
  kind: string
  number: string
}

export function NumberingPanel({
  formats,

  fiscalYear,

  fiscalYearStartsIn,

  canEdit,

  onChanged,
}: {
  formats: NumberFormat[]
  fiscalYear: number
  fiscalYearStartsIn: number
  canEdit: boolean
  onChanged: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, FormatDraft>>(() =>
    Object.fromEntries(formats.map((format) => [format.kind, toDraft(format)])),
  )

  const save = useSave()

  const issue = useSave()

  const [issued, setIssued] = useState<IssuedNumberPreview | null>(null)

  const [resetting, setResetting] = useState(false)

  // Re-seed only when the server sends a different set of formats, so a save
  // that round-trips does not discard what the user is still typing.
  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        formats.map((format) => [format.kind, toDraft(format)]),
      ),
    )
  }, [formats])

  const inputs = useMemo<NumberFormatInput[]>(
    () =>
      formats.map((format) => {
        const draft = drafts[format.kind] ?? toDraft(format)

        return {
          kind: format.kind,
          prefix: draft.prefix.trim(),
          padding: Number(draft.padding),
          resetYearly: draft.resetYearly,
        }
      }),
    [formats, drafts],
  )

  const invalid = formats.filter(
    (format) => !draftValid(drafts[format.kind] ?? toDraft(format)),
  )

  const dirty = useMemo(
    () =>
      inputs.some(
        (input, index) =>
          input.prefix !== formats[index].prefix ||
          input.padding !== formats[index].padding ||
          input.resetYearly !== formats[index].resetYearly,
      ),
    [inputs, formats],
  )

  const canSubmit = canEdit && dirty && invalid.length === 0 && !save.saving

  function set(kind: string, patch: Partial<FormatDraft>) {
    save.clear()

    setDrafts((current) => ({
      ...current,
      [kind]: { ...current[kind], ...patch },
    }))
  }

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && (
        <Alert>
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Your role can view numbering formats but not change them.
          </AlertDescription>
        </Alert>
      )}

      {save.error && (
        <Alert variant="danger">
          <AlertTitle>Could not save the formats</AlertTitle>
          <AlertDescription>{save.error}</AlertDescription>
        </Alert>
      )}

      {issue.error && (
        <Alert variant="danger">
          <AlertTitle>Could not issue a number</AlertTitle>
          <AlertDescription>{issue.error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash size={15} className="text-muted-foreground" />
            Numbering formats
          </CardTitle>
          <CardDescription>
            Financial year {fiscalYear} starts in month {fiscalYearStartsIn}. A
            format that resets yearly returns to 1 when the year rolls over.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {formats.map((format) => {
              const draft = drafts[format.kind] ?? toDraft(format)

              const preview = draftValid(draft)
                ? formatDocumentNumber(
                    draft.prefix.trim(),
                    Number(draft.padding),
                    format.nextValue,
                  )
                : "--"

              return (
                <Card key={format.kind}>
                  <CardHeader>
                    <CardTitle>{format.label}</CardTitle>
                    <CardDescription>
                      Next:{" "}
                      <span className="font-mono text-foreground">
                        {preview}
                      </span>
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-3.5">
                    <Field
                      label="Prefix"
                      htmlFor={`prefix-${format.kind}`}
                      error={
                        isValidPrefix(draft.prefix.trim())
                          ? fieldError(save, `prefix${capitalize(format.kind)}`)
                          : "Use up to 6 letters or digits, optionally with one separator."
                      }
                    >
                      <Input
                        id={`prefix-${format.kind}`}
                        value={draft.prefix}
                        disabled={!canEdit}
                        maxLength={8}
                        onChange={(e) =>
                          set(format.kind, {
                            prefix: e.target.value.toUpperCase(),
                          })
                        }
                      />
                    </Field>

                    <Field
                      label="Digits"
                      htmlFor={`padding-${format.kind}`}
                      error={
                        isValidPadding(Number(draft.padding))
                          ? fieldError(
                              save,
                              `padding${capitalize(format.kind)}`,
                            )
                          : "Use 3 to 8 digits."
                      }
                      hint="Zero padding applied to the sequence."
                    >
                      <Input
                        id={`padding-${format.kind}`}
                        type="number"
                        min={3}
                        max={8}
                        value={draft.padding}
                        disabled={!canEdit}
                        onChange={(e) =>
                          set(format.kind, { padding: e.target.value })
                        }
                      />
                    </Field>

                    <div className="flex items-start justify-between gap-3">
                      <span className="text-[13px] font-medium text-foreground">
                        Reset each year
                      </span>
                      <Switch
                        checked={draft.resetYearly}
                        disabled={!canEdit}
                        onCheckedChange={(on) =>
                          set(format.kind, { resetYearly: on === true })
                        }
                      />
                    </div>

                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={issue.saving}
                        onClick={() =>
                          void issue.run(async () => {
                            const result = await organizationApi.issueNumber(
                              format.kind,
                            )

                            setIssued({
                              kind: result.kind,
                              number: result.number,
                            })

                            onChanged()
                          })
                        }
                      >
                        <Ticket size={13} />
                        Issue next
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            {canEdit && (
              <>
                <Button
                  disabled={!canSubmit}
                  onClick={() =>
                    void save.run(async () => {
                      await organizationApi.updateNumbering(inputs)

                      onChanged()
                    })
                  }
                >
                  {save.saving
                    ? "Saving"
                    : save.saved
                      ? "Saved"
                      : dirty
                        ? "Save formats"
                        : "No changes"}
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => setResetting(true)}
                  disabled={save.saving}
                >
                  <RotateCcw size={13} />
                  Reset counters
                </Button>
              </>
            )}

            {issued && (
              <span className="text-[11.5px] text-muted-foreground">
                Issued{" "}
                <span className="font-mono text-foreground">
                  {issued.number}
                </span>{" "}
                for {NUMBER_KIND_LABELS[(issued.kind as "invoice")]}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {resetting && (
        <ResetDialog
          onClose={() => setResetting(false)}
          onReset={async () => {
            await save.run(async () => {
              await organizationApi.updateNumbering(inputs, true)

              onChanged()
            })

            setResetting(false)
          }}
          saving={save.saving}
        />
      )}
    </div>
  )
}

function ResetDialog({
  onClose,
  onReset,
  saving,
}: {
  onClose: () => void
  onReset: () => Promise<void>
  saving: boolean
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset every counter to 1?</DialogTitle>
          <DialogDescription>
            The next invoice, receipt, and booking will all be number 1 in their
            series. Documents already issued keep their numbers, so this creates
            duplicates in the audit trail. It is recorded as an audited action.
          </DialogDescription>
        </DialogHeader>

        <DialogBody />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={saving}
            onClick={() => void onReset()}
          >
            {saving ? "Resetting" : "Reset counters"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The server keys prefix/padding errors as `prefixInvoice`, `paddingReceipt`. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
