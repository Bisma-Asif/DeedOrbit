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

import { authApi, ApiError } from "@/lib/api"

import { navigate, readQueryParam } from "@/lib/router"

interface Values {
  password: string
  confirm: string
}

type Errors = Partial<Record<"password" | "confirm", string>>

function validate(values: Values): Errors {
  const errors: Errors = {}

  if (!values.password) {
    errors.password = "Choose a new password."
  } else {
    const missing = missingPasswordRules(values.password)

    if (missing.length > 0) {
      errors.password = `Needs ${missing.slice(0, 2).join(" and ")}.`
    }
  }

  if (values.confirm !== values.password)
    errors.confirm = "Passwords do not match."

  return errors
}

/**
 * Step two of recovery, opened from the emailed link. The token is consumed on
 * success and all other sessions are revoked, so a stolen link cannot be
 * replayed afterwards.
 */

export function ResetPasswordPage() {
  const [token] = useState(() => readQueryParam("token"))

  const [values, setValues] = useState<Values>({ password: "", confirm: "" })

  const [show, setShow] = useState(false)

  const [submitted, setSubmitted] = useState(false)

  const [pending, setPending] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [done, setDone] = useState(false)

  const localErrors = validate(values)

  const showError = (key: keyof Errors) =>
    Boolean(localErrors[key]) && (submitted || values[key].length > 0)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setSubmitted(true)

    setError(null)

    if (!token) {
      setError("This reset link is missing its token. Request a new one.")

      return
    }

    if (Object.keys(localErrors).length > 0) return

    setPending(true)

    try {
      await authApi.resetPassword(token, values.password)

      setDone(true)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "This link may have expired. Request a new one.",
      )
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <AuthLayout footerNote="All other sessions were signed out">
        <AuthHeading
          title="Password updated"
          description="You can sign in with the new password now. Any other device you were signed in on has been signed out."
        />
        <Button className="w-full" onClick={() => navigate("/login")}>
          Continue to sign in
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout footerNote="All other sessions will be signed out">
      <AuthHeading
        title="Choose a new password"
        description="Setting a new password signs out every other device on this account."
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Field
          label="New password"
          htmlFor="password"
          required
          error={showError("password") ? localErrors.password : undefined}
        >
          <div className="relative">
            <Input
              id="password"
              type={show ? "text" : "password"}
              name="password"
              autoComplete="new-password"
              value={values.password}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,

                  password: event.target.value,
                }))

                setError(null)
              }}
              className="pr-8"
            />
            <PasswordToggle
              visible={show}
              onToggle={() => setShow((value) => !value)}
            />
          </div>
        </Field>

        <PasswordMeter password={values.password} />

        <Field
          label="Confirm new password"
          htmlFor="confirm"
          required
          error={showError("confirm") ? localErrors.confirm : undefined}
        >
          <Input
            id="confirm"
            type={show ? "text" : "password"}
            name="confirm"
            autoComplete="new-password"
            value={values.confirm}
            onChange={(event) => {
              setValues((current) => ({
                ...current,

                confirm: event.target.value,
              }))

              setError(null)
            }}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Updating password…" : "Update password"}
        </Button>
      </form>

      <AuthLinkRow>
        Link expired?{" "}
        <a
          href="#/recover"
          className="font-medium text-primary hover:underline"
        >
          Request a new one
        </a>
      </AuthLinkRow>
    </AuthLayout>
  )
}
