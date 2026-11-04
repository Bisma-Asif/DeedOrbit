/**
 * Chart-of-accounts mapping.
 *
 * The tenant names one external account code per money-flow source; the journal
 * export reads the mapping so a handed-off statement carries the tenant's own
 * codes rather than an invented one. A source with no code exports with a blank
 * cell and an `unmapped` flag — never a fabricated account.
 *
 * Reads need `settings.view`; writes need `settings.edit`. The whole map is
 * loaded and saved in one shot so a half-saved chart cannot leave the journal
 * with gaps for a source the admin just edited around.
 */

import { useEffect, useMemo, useState } from "react"

import { BookText } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { Field } from "@/components/field"

import { Input } from "@/components/ui/input"

import { Skeleton } from "@/components/ui/skeleton"

import { useSave } from "@/features/organization/use-save"

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { chartOfAccountsApi } from "@/lib/chart-of-accounts-api"

import {
  COA_ACCOUNT_CODE_MAX,
  COA_SOURCE_HINTS,
  isValidAccountCode,
  type CoaSource,
} from "@shared/chart-of-accounts"

export function ChartOfAccountsPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const canEdit = session.can("settings", "edit")

  const resource = useAsyncResource(
    (signal) => chartOfAccountsApi.read(signal),

    canView,
  )

  const [draft, setDraft] = useState<Partial<Record<CoaSource, string>>>({})

  const [invalid, setInvalid] = useState<Record<string, string>>({})

  const save = useSave()

  useEffect(() => {
    const next: Partial<Record<CoaSource, string>> = {}

    for (const mapping of resource.data?.mappings ?? []) {
      next[mapping.source] = mapping.accountCode
    }

    setDraft(next)
  }, [resource.data])

  const rows = resource.data?.mappings ?? []

  const dirty = useMemo(() => {
    for (const row of rows) {
      if ((draft[row.source] ?? "") !== row.accountCode) return true
    }

    return false
  }, [draft, rows])

  if (!canView) {
    return (
      <EmptyState
        icon={BookText}
        title="Chart of accounts is not available to your role"
        description="Ask a workspace administrator for the settings grant to view this section."
        tone="pending"
      />
    )
  }

  async function submit() {
    const errors: Record<string, string> = {}

    const mappings = rows.map((row) => {
      const value = (draft[row.source] ?? "").trim()

      if (!isValidAccountCode(value)) {
        errors[row.source] =
          `Use up to ${COA_ACCOUNT_CODE_MAX} letters, digits, dot, or dash.`
      }

      return { source: row.source, accountCode: value }
    })

    if (Object.keys(errors).length > 0) {
      save.clear()

      setInvalid(errors)

      return
    }

    setInvalid({})

    const done = await save.run(async () => {
      await chartOfAccountsApi.save(mappings)
    })

    if (done) await resource.reload()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chart of accounts</CardTitle>
        <CardDescription>
          Map each money flow the platform produces to an account code in your
          external ledger. The journal export uses these codes; leave a field
          blank to skip mapping that flow for now.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-2">
        {save.error ? (
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        ) : null}

        {resource.loading && !resource.data ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BookText}
            size="sm"
            title="Nothing to map yet"
            description="This build has no chart-of-accounts sources to configure."
          />
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-md border border-border">
            {rows.map((row) => {
              const hint = COA_SOURCE_HINTS[row.source]

              const error = invalid[row.source] ?? save.fields[row.source]

              return (
                <div
                  key={row.source}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">
                      {row.label}
                    </p>
                    {hint ? (
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {hint}
                      </p>
                    ) : null}
                  </div>
                  <div className="w-full sm:w-52">
                    <Field
                      label="Account code"
                      htmlFor={`coa-${row.source}`}
                      className="[&_label]:sr-only"
                      error={error}
                    >
                      <Input
                        id={`coa-${row.source}`}
                        type="text"
                        maxLength={COA_ACCOUNT_CODE_MAX}
                        disabled={!canEdit}
                        value={draft[row.source] ?? ""}
                        placeholder="e.g. 4000-10"
                        onChange={(event) => {
                          const value = event.target.value

                          setDraft((current) => ({
                            ...current,
                            [row.source]: value,
                          }))

                          setInvalid((current) => {
                            if (!(row.source in current)) return current

                            const next = { ...current }

                            delete next[row.source]

                            return next
                          })

                          save.clear()
                        }}
                      />
                    </Field>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {canEdit ? (
          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={() => void submit()}
              disabled={save.saving || !dirty}
            >
              {save.saving ? "Saving…" : "Save chart"}
            </Button>
            {save.saved ? (
              <span className="text-[12px] text-success">Saved</span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            Your role can view this mapping but not change it.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
