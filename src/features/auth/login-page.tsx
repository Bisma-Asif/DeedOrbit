import { useState, type FormEvent } from "react"
import { KeyRound } from "lucide-react"
import {
  AuthHeading,
  AuthLayout,
  AuthLinkRow,
} from "@/features/auth/auth-layout"
import { PasswordToggle } from "@/features/auth/password-toggle"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Field } from "@/components/field"
import { useSession } from "@/lib/session-context"
import { ApiError } from "@/lib/api"

type Errors = {
  email?: string
  password?: string
}

type Credentials = {
  email: string
  password: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validate(values: Credentials): Errors {
  const errors: Errors = {}
  if (!values.email.trim()) {
    errors.email = "Work email is required."
  } else if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = "Enter a valid work email address."
  }
  if (!values.password) {
    errors.password = "Password is required."
  }
  return errors
}

/**
 * Email + password sign-in against `POST /api/auth/login`.
 *
 * The server is the authority on validity; this only short-circuits obviously
 * incomplete input so the user is not round-tripped for a blank field. Any
 * server-side field error is mapped back onto the matching control.
 */
export function LoginPage() {
  const { signIn } = useSession()
  const [values, setValues] = useState({ email: "", password: "" })
  const [touched, setTouched] = useState<{
    email?: boolean
    password?: boolean
  }>({})
  const [submitted, setSubmitted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [serverFields, setServerFields] = useState<Record<string, string>>({})

  const localErrors = validate(values)
  const errors: Errors = {
    email: serverFields.email ?? localErrors.email,
    password: serverFields.password ?? localErrors.password,
  }

  const showError = (key: "email" | "password") =>
    Boolean(errors[key]) && (Boolean(touched[key]) || submitted)

  function update(key: "email" | "password", value: string) {
    setValues((current) => ({ ...current, [key]: value }))
    setServerFields((current) => ({ ...current, [key]: "" }))
    setFormError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setServerFields({})
    setFormError(null)
    if (Object.keys(localErrors).length > 0) return

    setPending(true)
    try {
      // On "twofa" the provider raises the flag and App swaps in the challenge,
      // so this page does not navigate.
      await signIn(values.email.trim(), values.password)
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message)
        setServerFields(error.fields)
      } else {
        setFormError("Something went wrong. Try again.")
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <AuthHeading
        title="Sign in to your workspace"
        description="Access projects, inventory, bookings, and the payment ledger for your assigned organisations."
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Alert variant="danger">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Field
          label="Work email"
          htmlFor="email"
          required
          error={showError("email") ? errors.email : undefined}
          hint="Use the address issued by your organisation administrator."
        >
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            spellCheck={false}
            placeholder="name@organisation.com"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            onBlur={() =>
              setTouched((current) => ({ ...current, email: true }))
            }
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          error={showError("password") ? errors.password : undefined}
        >
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={values.password}
              onChange={(event) => update("password", event.target.value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, password: true }))
              }
              className="pr-8"
            />
            <PasswordToggle
              visible={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          </div>
        </Field>

        <div className="flex items-center justify-between">
          <a
            href="#/recover"
            className="text-[12px] font-medium text-primary hover:underline"
          >
            Forgot password?
          </a>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          or
        </span>
        <Separator className="flex-1" />
      </div>

      <Button variant="outline" size="lg" className="w-full" disabled>
        <KeyRound size={14} /> Continue with single sign-on
      </Button>
      <p className="mt-4 text-[11.5px] leading-4 text-muted-foreground">
        Single sign-on is provisioned per organisation. Contact your
        administrator to enable it.
      </p>

      <AuthLinkRow>
        Setting up a new workspace?{" "}
        <a href="#/signup" className="font-medium text-primary hover:underline">
          Create one
        </a>
      </AuthLinkRow>
    </AuthLayout>
  )
}
