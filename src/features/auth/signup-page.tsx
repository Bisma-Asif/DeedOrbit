import { useState, type FormEvent } from "react"
import {
  AuthHeading,
  AuthLayout,
  AuthLinkRow,
} from "@/features/auth/auth-layout"
import { PasswordToggle } from "@/features/auth/password-toggle"
import { PasswordMeter } from "@/features/auth/password-meter"
import { missingPasswordRules } from "@/features/auth/password-rules"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { useSession } from "@/lib/session-context"
import { ApiError } from "@/lib/api"

type Values = {
  fullName: string
  email: string
  workspaceName: string
  password: string
}

type Errors = Partial<Record<keyof Values | "confirm", string>>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validate(values: Values, confirm: string): Errors {
  const errors: Errors = {}
  if (values.fullName.trim().length < 2)
    errors.fullName = "Enter your full name."
  if (!values.email.trim()) errors.email = "Work email is required."
  else if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = "Enter a valid work email address."
  }
  if (values.workspaceName.trim().length < 2) {
    errors.workspaceName = "Enter the name your team will recognise."
  }
  if (!values.password) errors.password = "Password is required."
  else {
    const missing = missingPasswordRules(values.password)
    if (missing.length > 0) {
      errors.password = `Needs ${missing.slice(0, 2).join(" and ")}.`
    }
  }
  if (values.password !== confirm) errors.confirm = "Passwords do not match."
  return errors
}

/**
 * Creates a workspace and its owning Tenant Admin in one transaction. The new
 * tenant starts from the platform default grants, so the owner is immediately
 * able to administer users and roles.
 */
export function SignupPage() {
  const { signUp } = useSession()
  const [values, setValues] = useState<Values>({
    fullName: "",
    email: "",
    workspaceName: "",
    password: "",
  })
  const [confirm, setConfirm] = useState("")
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [serverFields, setServerFields] = useState<Record<string, string>>({})

  const localErrors = validate(values, confirm)
  const errors: Errors = { ...localErrors, ...serverFields }

  const showError = (key: keyof Errors) =>
    Boolean(errors[key]) && (Boolean(touched[(key as string)]) || submitted)

  function update<K extends keyof Values>(key: K, value: string) {
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
      await signUp({
        fullName: values.fullName.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
        workspaceName: values.workspaceName.trim(),
      })
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
        title="Create your workspace"
        description="Sets up a new tenant with you as Tenant Owner. You can invite your team and adjust their roles afterwards."
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Alert variant="danger">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Field
          label="Your full name"
          htmlFor="fullName"
          required
          error={showError("fullName") ? errors.fullName : undefined}
        >
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            placeholder="Amina Rahman"
            value={values.fullName}
            onChange={(event) => update("fullName", event.target.value)}
            onBlur={() =>
              setTouched((current) => ({ ...current, fullName: true }))
            }
          />
        </Field>

        <Field
          label="Work email"
          htmlFor="email"
          required
          error={showError("email") ? errors.email : undefined}
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
          label="Workspace name"
          htmlFor="workspaceName"
          required
          error={showError("workspaceName") ? errors.workspaceName : undefined}
          hint="Shown to everyone you invite."
        >
          <Input
            id="workspaceName"
            name="organization"
            autoComplete="organization"
            placeholder="DeedOrbit Holdings"
            value={values.workspaceName}
            onChange={(event) => update("workspaceName", event.target.value)}
            onBlur={() =>
              setTouched((current) => ({ ...current, workspaceName: true }))
            }
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          error={showError("password") ? errors.password : undefined}
          hint="Use 10+ characters with upper case, lower case, and a number."
        >
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="new-password"
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

        <PasswordMeter password={values.password} />

        <Field
          label="Confirm password"
          htmlFor="confirm"
          required
          error={showError("confirm") ? errors.confirm : undefined}
        >
          <Input
            id="confirm"
            type={showPassword ? "text" : "password"}
            name="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value)
              setFormError(null)
            }}
            onBlur={() =>
              setTouched((current) => ({ ...current, confirm: true }))
            }
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Creating workspace…" : "Create workspace"}
        </Button>
      </form>

      <AuthLinkRow>
        Already have an account?{" "}
        <a href="#/login" className="font-medium text-primary hover:underline">
          Sign in
        </a>
      </AuthLinkRow>
    </AuthLayout>
  )
}
