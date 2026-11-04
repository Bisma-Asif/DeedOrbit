/**
 * Password policy shared by sign-up, password reset, and the change-password
 * form. This is a client-side copy of `checkPassword` in `server/crypto.ts` so
 * the user gets immediate feedback — the server still re-checks every request,
 * because a client-side rule is a hint, never a guarantee.
 */
export type PasswordRule = {
  id: "length" | "lower" | "upper" | "digit"
  label: string
  met: boolean
}

export function passwordRules(password: string): PasswordRule[] {
  return [
    {
      id: "length",
      label: "10 or more characters",
      met: password.length >= 10,
    },
    { id: "lower", label: "A lowercase letter", met: /[a-z]/.test(password) },
    { id: "upper", label: "An uppercase letter", met: /[A-Z]/.test(password) },
    { id: "digit", label: "A number", met: /\d/.test(password) },
  ]
}

/** Names of unmet rules, most structural first, for inline error copy. */
export function missingPasswordRules(password: string): string[] {
  return passwordRules(password)
    .filter((rule) => !rule.met)
    .map((rule) => rule.label.toLowerCase())
}
