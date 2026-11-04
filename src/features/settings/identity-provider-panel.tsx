/**
 * Identity verification provider — the optional live government-ID check.
 *
 * This screen only exists so that a real provider can be wired in later; on its
 * own it never claims a check happened. The mode that decides whether identity
 * verification runs at all lives on the Document Verification tab ("manual" vs
 * "provider"); here you configure *which* provider a "provider" mode would call
 * and test that it actually answers.
 *
 * Credentials are write-only: the plaintext is encrypted at rest and never
 * echoed back — you get a masked hint instead, and leaving the field blank on
 * save keeps the stored secret rather than wiping it. The "Test connection"
 * action performs a real round-trip and reports honestly — a manual or
 * misconfigured provider answers nothing, and we say "did not answer" rather
 * than pretending a check succeeded.
 */

import { useEffect, useState } from "react"

import { AlertTriangle, PlugZap } from "lucide-react"

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

import { useSession } from "@/lib/session-context"

import { useAsyncResource } from "@/lib/use-async-resource"

import { formatDate } from "@/lib/format"

import {
  documentVerificationApi,
  type IdentityProviderTestResponse,
  type IdentityProviderView,
} from "@/lib/document-verification-api"

type ProviderKind = "generic" | "nadra_verisys"

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  generic: "Generic HTTP endpoint",

  nadra_verisys: "NADRA / VERISYS",
}

interface ProviderDraft {
  provider: ProviderKind

  endpoint: string

  credential: string

  enabled: boolean
}

function seed(view: IdentityProviderView | null): ProviderDraft {
  return {
    provider: view && isProviderKind(view.provider) ? view.provider : "generic",

    endpoint: view?.endpoint ?? "",

    credential: "",

    enabled: view ? view.enabled : true,
  }
}

function isProviderKind(value: string): value is ProviderKind {
  return value === "generic" || value === "nadra_verisys"
}

export function IdentityProviderPanel() {
  const session = useSession()

  const canView = session.can("settings", "view")

  const resource = useAsyncResource(
    (signal) => documentVerificationApi.getIdentityProvider(signal),

    canView,
  )

  const [draft, setDraft] = useState<ProviderDraft | null>(null)

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const [testResult, setTestResult] =
    useState<IdentityProviderTestResponse | null>(null)

  const [testing, setTesting] = useState(false)

  const save = useSave()

  useEffect(() => {
    if (resource.data) setDraft(seed(resource.data.provider))
  }, [resource.data])

  if (!canView) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Identity provider settings are not available to your role"
        description="Ask a workspace administrator for the settings grant to view this section."
        tone="pending"
      />
    )
  }

  if (resource.error && !resource.data) {
    return (
      <Alert variant="danger">
        <AlertDescription>{resource.error}</AlertDescription>
      </Alert>
    )
  }

  if (!resource.data || !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Identity verification provider</CardTitle>
          <CardDescription>Loading provider configuration</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  const view = resource.data.provider

  const canEdit = session.can("settings", "edit")

  function patch(next: Partial<ProviderDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current))

    setFormErrors({})

    save.clear()

    setTestResult(null)
  }

  async function submit() {
    if (!draft) return

    const errors: Record<string, string> = {}

    if (
      draft.endpoint.trim() !== "" &&
      !/^https?:\/\//i.test(draft.endpoint.trim())
    ) {
      errors.endpoint = "Use a URL starting with http:// or https://."
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)

      return
    }

    setFormErrors({})

    const done = await save.run(async () => {
      await documentVerificationApi.patchIdentityProvider({
        provider: draft.provider,

        endpoint: draft.endpoint.trim(),

        enabled: draft.enabled,

        ...(draft.credential.trim() !== ""
          ? { credential: draft.credential.trim() }
          : {}),
      })
    })

    if (done) {
      save.clear()

      setDraft(seed(null))

      await resource.reload()
    }
  }

  async function runTest() {
    setTesting(true)

    setTestResult(null)

    try {
      const result = await documentVerificationApi.testIdentityProvider()

      setTestResult(result)

      await resource.reload()
    } catch (error) {
      setTestResult({
        ok: false,

        message:
          error instanceof Error ? error.message : "The test request failed.",
      })
    } finally {
      setTesting(false)
    }
  }

  const errorFor = (key: string) => formErrors[key] ?? save.fields[key]

  const credentialHint = view?.credentialHint ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity verification provider</CardTitle>
        <CardDescription>
          Configure the live government-ID check that provider mode would call.
          Nothing here marks a document verified — until a provider answers a
          real check, every stamp stays manual.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-2">
        {save.error ? (
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        ) : null}

        {view ? null : (
          <Alert variant="pending">
            <AlertDescription>
              No provider is saved yet. Configuring one here only takes effect
              once the Document Verification tab is set to provider mode.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">
              Enable this provider
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              A disabled provider is stored but never called.
            </p>
          </div>
          <Switch
            checked={draft.enabled}
            disabled={!canEdit}
            aria-label="Enable this provider"
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
        </div>

        <Field label="Provider" htmlFor="identity-provider">
          <Select
            value={draft.provider}
            onValueChange={(value) =>
              patch({ provider: value as ProviderKind })
            }
            disabled={!canEdit}
          >
            <SelectTrigger id="identity-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDER_LABELS) as ProviderKind[]).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {PROVIDER_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Endpoint URL"
          htmlFor="identity-endpoint"
          error={errorFor("endpoint")}
          hint="The HTTPS address the check is posted to."
        >
          <Input
            id="identity-endpoint"
            type="url"
            placeholder="https://provider.example/verify"
            disabled={!canEdit}
            value={draft.endpoint}
            onChange={(event) => patch({ endpoint: event.target.value })}
          />
        </Field>

        <Field
          label="Credential / API key"
          htmlFor="identity-credential"
          hint={
            credentialHint
              ? `A credential is stored (ending ${credentialHint}). Leave blank to keep it, or type a new one to replace it.`
              : "Stored encrypted and never shown again after saving."
          }
        >
          <Input
            id="identity-credential"
            type="password"
            autoComplete="off"
            placeholder={
              credentialHint ? "•••••• (unchanged)" : "Provider secret"
            }
            disabled={!canEdit}
            value={draft.credential}
            onChange={(event) => patch({ credential: event.target.value })}
          />
        </Field>

        <p className="text-[11.5px] text-muted-foreground">
          Encryption key source:{" "}
          {resource.data.keySource === "env"
            ? "the ENCRYPTION_KEY environment variable."
            : "a local key file created on first boot — set ENCRYPTION_KEY for production."}
          {view?.lastCheckedAt
            ? ` Last tested ${formatDate(view.lastCheckedAt)}.`
            : ""}
        </p>

        {testResult ? (
          <Alert variant={testResult.ok ? "success" : "pending"}>
            <AlertDescription>{testResult.message}</AlertDescription>
          </Alert>
        ) : null}

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button disabled={save.saving} onClick={() => void submit()}>
              {save.saving ? "Saving…" : "Save provider"}
            </Button>

            <Button
              variant="outline"
              disabled={testing || !view || !draft.enabled}
              onClick={() => void runTest()}
            >
              <PlugZap size={13} />
              {testing ? "Testing…" : "Test connection"}
            </Button>

            {save.saved ? (
              <span className="text-[12px] text-success">Saved</span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            Your role can view this configuration but not change it.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
