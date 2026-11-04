import { useState, type FormEvent } from "react"
import { MailCheck } from "lucide-react"
import {
  AuthHeading,
  AuthLayout,
  AuthLinkRow,
} from "@/features/auth/auth-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { authApi, ApiError } from "@/lib/api"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Step one of password recovery. The response is identical whether or not the
 * address exists, so this screen must not reveal whether an account is
 * registered — the copy stays deliberately generic either way.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{
    email: string
    token: string | null
  } | null>(null)

  const invalid = submitted && !EMAIL_PATTERN.test(email.trim())

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setError(null)
    if (!EMAIL_PATTERN.test(email.trim())) return

    setPending(true)
    try {
      const result = await authApi.forgotPassword(email.trim().toLowerCase())
      setIssued({ email: email.trim(), token: result.devResetToken ?? null })
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Try again in a moment.",
      )
    } finally {
      setPending(false)
    }
  }

  if (issued) {
    return (
      <AuthLayout footerNote="Recovery links expire in 30 minutes">
        <AuthHeading
          title="Check your inbox"
          description={`If an account exists for ${issued.email}, a recovery link is on its way. It stays valid for 30 minutes.`}
        />

        <Alert>
          <MailCheck size={15} />
          <AlertDescription>
            The link opens the reset form. If it does not arrive, confirm the
            address with your administrator, then try again.
          </AlertDescription>
        </Alert>

        {/* Development only: the server omits the token unless
            DEEDORBIT_EXPOSE_RESET_TOKEN=1, since there is no mail transport yet. */}
        {issued.token ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-[10.5px] font-semibold tracking-[0.08em] text-amber-700 uppercase">
              Development only
            </p>
            <p className="mt-1 text-[11.5px] leading-4 text-muted-foreground">
              No mail service is wired up, so the server returned the token
              directly.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full font-mono"
              onClick={() => {
                window.location.hash = `#/recover/reset?token=${issued.token}`
              }}
            >
              Open reset form
            </Button>
          </div>
        ) : null}

        <AuthLinkRow>
          <a
            href="#/login"
            className="font-medium text-primary hover:underline"
          >
            Back to sign in
          </a>
        </AuthLinkRow>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout footerNote="Recovery links expire in 30 minutes">
      <AuthHeading
        title="Reset your password"
        description="Enter the work email on your account and we will send a link to set a new password."
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Field
          label="Work email"
          htmlFor="email"
          required
          error={invalid ? "Enter a valid work email address." : undefined}
        >
          <Input
            id="email"
            type="email"
            name="email"
            inputMode="email"
            spellCheck={false}
            autoComplete="username"
            placeholder="name@organisation.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError(null)
            }}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Sending link…" : "Send recovery link"}
        </Button>
      </form>

      <AuthLinkRow>
        Remembered it?{" "}
        <a href="#/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </a>
      </AuthLinkRow>
    </AuthLayout>
  )
}
