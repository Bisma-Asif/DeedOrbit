import { useState, type FormEvent } from "react"
import { KeyRound, ShieldCheck } from "lucide-react"
import { AuthHeading, AuthLayout } from "@/features/auth/auth-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { useSession } from "@/lib/session-context"
import { ApiError } from "@/lib/api"
import { navigate } from "@/lib/router"

/**
 * Second-factor challenge. Reached automatically after a successful password
 * check when the account has 2FA enabled — the session cookie exists at this
 * point but is held at `pending_twofa`, so every protected route still returns
 * 401 until this screen completes.
 */
export function TwoFactorPage() {
  const { completeTwofa, data, signOut } = useSession()
  const [mode, setMode] = useState<"code" | "recovery">("code")
  const [code, setCode] = useState("")
  const [recoveryCode, setRecoveryCode] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (mode === "code" && code.replace(/\D/g, "").length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.")
      return
    }
    if (mode === "recovery" && recoveryCode.trim().length < 4) {
      setError("Enter one of your recovery codes.")
      return
    }

    setPending(true)
    try {
      await completeTwofa(
        mode === "code" ? code.replace(/\D/g, "") : "",
        mode === "recovery" ? recoveryCode.trim() : undefined,
      )
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "That code is not valid.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      footerNote="Second factor required for this account"
      aside={
        <div>
          <p className="text-[10.5px] font-semibold tracking-[0.12em] text-nav-subtle uppercase">
            Verification
          </p>
          <h2 className="mt-4 max-w-md text-[22px] leading-7 font-semibold tracking-tight">
            Two-factor authentication is on for this account.
          </h2>
          <p className="mt-3 max-w-md text-[13px] leading-6 text-nav-muted">
            Enter the current code from your authenticator app. If you no longer
            have the device, sign in with one of the single-use recovery codes
            issued when you enabled it.
          </p>
        </div>
      }
    >
      <AuthHeading
        title="Confirm it is you"
        description={`Signed in as ${data?.user.email ?? "your account"}. Enter your second factor to continue.`}
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {mode === "code" ? (
          <Field
            label="Authentication code"
            htmlFor="code"
            required
            hint="Six digits, refreshed every 30 seconds."
          >
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              spellCheck={false}
              placeholder="000000"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
              className="tabular-nums tracking-[0.3em]"
            />
          </Field>
        ) : (
          <Field
            label="Recovery code"
            htmlFor="recovery"
            required
            hint="Each code works once. Codes look like ABCDE-12345."
          >
            <Input
              id="recovery"
              name="recovery"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCDE-12345"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              className="font-mono"
            />
          </Field>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Verifying…" : "Verify and continue"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "code" ? "recovery" : "code")
            setError(null)
          }}
          className="text-[12px] font-medium text-primary hover:underline"
        >
          {mode === "code"
            ? "Use a recovery code instead"
            : "Use your authenticator app instead"}
        </button>
      </form>

      <div className="mt-6 flex items-start gap-2 border-t border-border pt-4 text-[11.5px] leading-4 text-muted-foreground">
        <ShieldCheck size={13} className="mt-px shrink-0" />
        <p>
          Having trouble? Sign out and contact your tenant administrator to
          reset two-factor authentication on your account.
        </p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-2 w-full"
        onClick={() => void signOut()}
      >
        <KeyRound size={13} /> Cancel and sign out
      </Button>
    </AuthLayout>
  )
}

export function NotFoundAuth() {
  return (
    <AuthLayout>
      <AuthHeading
        title="That screen does not exist"
        description="The link may be out of date, or your role may not include it."
      />
      <Button className="w-full" onClick={() => navigate("/login")}>
        Back to sign in
      </Button>
    </AuthLayout>
  )
}
