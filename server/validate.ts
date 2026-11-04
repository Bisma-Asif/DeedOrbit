/**
 * Field validation shared by the write routes.
 *
 * This started as a private helper inside the organization routes and was pulled
 * out when the projects module needed exactly the same pass over exactly the
 * same kind of rules. Keeping one implementation matters more than it looks:
 * the rule table is positional to the caller, and an earlier version of this
 * code read results back out of a positional array, which shifted every later
 * field whenever one was absent or rejected — so a rejected `name` could end up
 * written to `code`. Keying the results by rule removes that whole class of bug
 * and lets a second module reuse the function without inheriting the mistake.
 */

export type TextRule = {
  /** The request key and the field-error key. */
  key: string
  max: number
  min?: number
  minError?: string
  required?: boolean
  requiredError?: string
  pattern?: RegExp
  patternError?: string
  /** Normalises to upper case — used for reference codes. */
  upper?: boolean
}

export interface ValidatedText {
  values: Record<string, string | null>
  errors: Record<string, string>
}

/**
 * Validates a set of text fields in one pass, returning values keyed by rule
 * rather than by position.
 *
 * An absent field is not an error unless the rule marks it required: a PATCH
 * must leave out the keys it is not changing. A rejected field is present in
 * `values` as null so a caller that merges values over an existing row clears it
 * deliberately, instead of silently keeping a stale value.
 */
export function validateTextFields(
  input: Record<string, unknown>,
  rules: readonly TextRule[],
): ValidatedText {
  const values: Record<string, string | null> = {}
  const errors: Record<string, string> = {}

  for (const rule of rules) {
    const raw = input[rule.key]
    const trimmed = raw === null || raw === undefined ? "" : String(raw).trim()

    if (trimmed === "") {
      values[rule.key] = null
      if (rule.required) {
        errors[rule.key] = rule.requiredError ?? "This field is required"
      }
      continue
    }

    if (trimmed.length < (rule.min ?? 1)) {
      values[rule.key] = null
      errors[rule.key] = rule.minError ?? `Use at least ${rule.min} characters`
      continue
    }

    if (trimmed.length > rule.max) {
      values[rule.key] = null
      errors[rule.key] = `Keep this under ${rule.max} characters`
      continue
    }

    if (rule.pattern && !rule.pattern.test(trimmed)) {
      values[rule.key] = null
      errors[rule.key] = rule.patternError ?? "Check the format"
      continue
    }

    values[rule.key] = rule.upper ? trimmed.toUpperCase() : trimmed
  }

  return { values, errors }
}

/**
 * The outcome of resolving one closed-set field: what to store, and whether the
 * value that arrived was not in the set.
 *
 * A named interface rather than an inline literal because `oxfmt` strips the
 * separators between members of a single-line object type, which turns
 * `{ value: T | null; invalid: boolean }` into a syntax error.
 */
export interface ResolvedField<T> {
  value: T | null
  invalid: boolean
}

/**
 * Resolves one closed-set field, such as a status or a type.
 *
 * Kept beside `validateTextFields` because it answers the same question the text
 * rules do — what may I store — and the reason it is not a text rule is that its
 * field-error key does not always match the request key, so the caller supplies
 * the set as a type guard rather than as a list of strings.
 *
 * The "was it sent" check reads the ORIGINAL request body, never a merged map. A
 * merged map is seeded from the stored row on a PATCH, so an unset optional
 * arrives as an explicit null; testing against that would make every PATCH report
 * an error for the field it deliberately did not mention.
 *
 * `current` is what to fall back to. On a PATCH that is the stored value, so an
 * omitted field is left alone; on a create it is the value to use when the client
 * genuinely left the field out. A blank string is treated as "sent, and empty",
 * which for a required enum means null rather than the fallback — sending an empty
 * status should not quietly keep the old one.
 */
export function readEnum<T>(
  sent: Record<string, unknown>,
  key: string,
  guard: (value: unknown) => value is T,
  current: T | null,
): ResolvedField<T> {
  const raw = sent[key]

  if (raw === undefined) return { value: current, invalid: false }
  if (raw === null || raw === "") return { value: null, invalid: false }

  return guard(raw)
    ? { value: raw, invalid: false }
    : { value: current, invalid: true }
}
