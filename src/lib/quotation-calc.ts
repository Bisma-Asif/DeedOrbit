/**
 * The arithmetic a quotation is made of, shared by the form's live preview and the
 * printable document.
 *
 * This mirrors the server's integer math exactly — `Math.round` on the percent
 * discount, the same down payment, the same division of the balance where the
 * first `remainder` installments carry one extra unit of currency. A preview that
 * rounded differently would promise a figure the stored quote then contradicted,
 * and a document nobody can reproduce from its own inputs is not a document.
 *
 * Money here is always whole minor-less units, matching `UNIT_PRICE_MAX` and the
 * server's `readInteger`: the same reason the inventory refuses float prices — a
 * float would eventually round a quote by a fils and make it disagree with the
 * figure that was typed.
 */

import { formatCurrency } from "@/lib/format"

import { UNIT_PRICE_MAX } from "@shared/inventory"

export type DiscountType = "percent" | "fixed"

export interface QuoteCalcInput {
  basePrice: number

  discountType: DiscountType

  /** A percent of the base price, or a fixed amount in the listing currency. */

  discountValue: number

  extraCharges: number

  downPaymentPercent: number

  installmentCount: number
}

/** One line of the proposed plan: the down payment, or a single installment. */

export interface QuotePlanItem {
  label: string

  amount: number
}

export interface QuoteCalcResult {
  discountAmount: number

  extraCharges: number

  total: number

  downPayment: number

  balance: number

  /**
   * How many of the first installments carry one extra unit of currency, so the
   * preview can say so instead of claiming an even split it did not make.
   */

  remainder: number

  /** Down payment first, then one item per installment. Never empty. */

  paymentPlan: QuotePlanItem[]
}

/**
 * The whole quote from its inputs, with no rounding of its own beyond the server's.
 *
 * Callers must validate ranges first (`readWholeNumber` below does); this assumes
 * what it is given already fits, the same way the server's handler does after its
 * own `readInteger` pass.
 */

export function calculateQuote(input: QuoteCalcInput): QuoteCalcResult {
  const {
    basePrice,

    discountType,

    discountValue,

    extraCharges,

    downPaymentPercent,

    installmentCount,
  } = input

  const discountAmount =
    discountType === "percent"
      ? Math.round((basePrice * discountValue) / 100)
      : discountValue

  const total = basePrice - discountAmount + extraCharges

  const downPayment = Math.round((total * downPaymentPercent) / 100)

  const balance = total - downPayment

  // The server's exact split: an even base, and the first `remainder`

  // installments each carry one more so the plan sums to the balance.

  const installmentBase = Math.floor(balance / installmentCount)

  const remainder = balance % installmentCount

  const paymentPlan = [
    { label: `Down payment (${downPaymentPercent}%)`, amount: downPayment },

    ...Array.from({ length: installmentCount }, (_, index) => ({
      label: `Installment ${index + 1}`,

      amount: installmentBase + (index < remainder ? 1 : 0),
    })),
  ]

  return {
    discountAmount,

    extraCharges,

    total,

    downPayment,

    balance,

    remainder,

    paymentPlan,
  }
}

/** How the discount reads in words, for the document's line and the form's hint. */

export function discountLabel(
  discountType: DiscountType,

  discountValue: number,

  currency: string,
): string {
  return discountType === "percent"
    ? `${discountValue}% of unit price`
    : formatCurrency(discountValue, currency, { maximumFractionDigits: 0 })
}

/** What the form collects. Numbers stay strings because inputs hand strings over. */

export interface QuotationFormState {
  recipientType: "lead" | "customer"

  leadId: string

  customerId: string

  discountType: DiscountType

  discountValue: string

  extraCharges: string

  downPaymentPercent: string

  installmentCount: string

  notes: string
}

export function emptyQuotationForm(
  recipientType: "lead" | "customer" = "lead",
): QuotationFormState {
  return {
    recipientType,

    leadId: "",

    customerId: "",

    discountType: "percent",

    discountValue: "",

    extraCharges: "",

    downPaymentPercent: "20",

    installmentCount: "12",

    notes: "",
  }
}

/** Bounds the form and the server agree on; anything else is refused twice. */

export const QUOTATION_BOUNDS = {
  discountPercentMax: 100,

  downPaymentPercentMax: 100,

  installmentMin: 1,

  installmentMax: 60,

  notesMax: 1000,
} as const

/**
 * Parse one numeric field the way the server's `readInteger` does.
 *
 * An empty field falls back — the server substitutes its own default for what is
 * blank — so the preview can show the plan a blank form would produce instead of
 * a wall of errors before the user has typed anything. A field that is present but
 * not a whole number within bounds is an error, and `null` makes the preview say
 * "complete the form" rather than render a figure computed from a guess.
 */

function readWholeNumber(
  raw: string,

  key: string,

  errors: Record<string, string>,

  fallback: number | null,

  min: number,

  max: number,

  maxLabel: string,
): number | null {
  if (raw.trim() === "") {
    return fallback
  }

  const value = Number(raw)

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors[key] = `Enter a whole number from ${min} to ${maxLabel}.`

    return null
  }

  return value
}

export interface QuotationPreview {
  /** Per-field messages, in the shape `useSave` expects from the server. */

  errors: Record<string, string>

  /** Null while any field is missing, invalid, or the total is out of range. */

  quote: QuoteCalcResult | null

  /** The recipient id the create call should carry, once the form is valid. */

  recipientId: string | null

  notes: string | null
}

/**
 * Validate the whole form and compute the preview in one pass.
 *
 * One function because the rules cross fields: the fixed discount is capped by the
 * base price, the percent discount by 100, and the total — the figure the document
 * prints — is capped by the price range the platform supports. Computing after
 * validating means a preview number only ever exists for a form the server would
 * accept, which is the difference between a preview and a guess.
 */

export function buildQuotationPreview(
  form: QuotationFormState,

  basePrice: number,
): QuotationPreview {
  const errors: Record<string, string> = {}

  const recipientId =
    form.recipientType === "lead" ? form.leadId : form.customerId

  if (recipientId === "") {
    errors.recipient = "Choose the lead or customer this quote is addressed to."
  }

  const discountMax =
    form.discountType === "percent"
      ? QUOTATION_BOUNDS.discountPercentMax
      : UNIT_PRICE_MAX

  const discountValue = readWholeNumber(
    form.discountValue,

    "discountValue",

    errors,

    0,

    0,

    discountMax,

    String(discountMax),
  )

  const extraCharges = readWholeNumber(
    form.extraCharges,

    "extraCharges",

    errors,

    0,

    0,

    UNIT_PRICE_MAX,

    formatCurrency(UNIT_PRICE_MAX, "USD", { maximumFractionDigits: 0 }),
  )

  const downPaymentPercent = readWholeNumber(
    form.downPaymentPercent,

    "downPaymentPercent",

    errors,

    20,

    0,

    QUOTATION_BOUNDS.downPaymentPercentMax,

    String(QUOTATION_BOUNDS.downPaymentPercentMax),
  )

  const installmentCount = readWholeNumber(
    form.installmentCount,

    "installmentCount",

    errors,

    12,

    QUOTATION_BOUNDS.installmentMin,

    QUOTATION_BOUNDS.installmentMax,

    String(QUOTATION_BOUNDS.installmentMax),
  )

  if (form.notes.length > QUOTATION_BOUNDS.notesMax) {
    errors.notes = `Use ${QUOTATION_BOUNDS.notesMax.toLocaleString("en-US")} characters or fewer.`
  }

  // Checked here rather than left to the server because the preview would print a

  // negative total: a fixed discount larger than the base price is the one

  // cross-field rule the individual bounds cannot see.

  if (
    discountValue !== null &&
    form.discountType === "fixed" &&
    discountValue > basePrice
  ) {
    errors.discountValue = "Discount cannot exceed the unit price."
  }

  const invalid =
    Object.keys(errors).length > 0 ||
    discountValue === null ||
    extraCharges === null ||
    downPaymentPercent === null ||
    installmentCount === null

  if (invalid) {
    return { errors, quote: null, recipientId: null, notes: null }
  }

  const quote = calculateQuote({
    basePrice,

    discountType: form.discountType,

    discountValue,

    extraCharges,

    downPaymentPercent,

    installmentCount,
  })

  if (!Number.isSafeInteger(quote.total) || quote.total > UNIT_PRICE_MAX) {
    return {
      errors: {
        extraCharges: "The total exceeds the supported price range.",
      },

      quote: null,

      recipientId: null,

      notes: null,
    }
  }

  return {
    errors,

    quote,

    recipientId,

    notes: form.notes.trim() === "" ? null : form.notes.trim(),
  }
}
