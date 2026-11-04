/**
 * Communication template vocabulary: what a message would say.
 *
 * Nothing in this module opens a socket to a mail or messaging provider. It stores
 * the body a message would carry, substitutes the values into it, and reports which
 * tokens had nothing to substitute — that is the whole surface. The sending itself
 * belongs to `server/messaging/`; this file is what those senders read.
 *
 * Templates are keyed by *purpose* rather than by document, because the purposes
 * are the moments a workspace actually cares about: an instalment approaching its
 * due date, the day it falls due, the chase after it, a confirmation after money
 * lands, a receipt, a booking confirmation, and an update on a service request.
 * Every purpose is offered on every channel and in both shipped languages — the
 * desk edits words, the engine picks the language per customer, nothing is ever
 * translated at send time.
 *
 * `renderTemplate` reports missing tokens instead of throwing or inventing a
 * value. A blank `{due_amount}` in a preview is a thing a workspace can see and
 * fix; a substituted placeholder is a lie that reaches the customer.
 */

export const MESSAGE_CHANNELS = ["email", "sms", "whatsapp"] as const

export type MessageChannel = typeof MESSAGE_CHANNELS[number]

export const MESSAGE_CHANNEL_LABELS: Record<MessageChannel, string> = {
  email: "Email",

  sms: "SMS",

  whatsapp: "WhatsApp",
}

export function isMessageChannel(value: unknown): value is MessageChannel {
  return (
    typeof value === "string" &&
    (MESSAGE_CHANNELS as readonly string[]).includes(value)
  )
}

/**
 * The two languages the platform ships template wording in.
 *
 * English and Urdu cover the whole customer base of a Pakistani workspace without
 * pretending to more: the reminder engine picks one of these per customer, and a
 * body that was *written* in Urdu reads like Urdu, which a machine-translated one
 * never does. Codes are the ISO 639-1 forms the `Accept-Language` world already
 * knows, and the ledger stores which one actually went out.
 */

export const MESSAGE_LANGUAGES = ["en", "ur"] as const

export type MessageLanguage = typeof MESSAGE_LANGUAGES[number]

export const MESSAGE_LANGUAGE_LABELS: Record<MessageLanguage, string> = {
  en: "English",

  ur: "Urdu (اردو)",
}

export function isMessageLanguage(value: unknown): value is MessageLanguage {
  return (
    typeof value === "string" &&
    (MESSAGE_LANGUAGES as readonly string[]).includes(value)
  )
}

export const TEMPLATE_KEYS = [
  "due_payment_reminder",

  "payment_due_today",

  "payment_overdue",

  "payment_received",

  "receipt",

  "booking_confirmation",

  "service_request_update",

  "document_upload_reminder",

  "document_rejected",

  "document_expiring",

  "document_verified",
] as const

export type TemplateKey = typeof TEMPLATE_KEYS[number]

export const TEMPLATE_KEY_LABELS: Record<TemplateKey, string> = {
  due_payment_reminder: "Due payment reminder",

  payment_due_today: "Payment due today",

  payment_overdue: "Overdue payment notice",

  payment_received: "Payment received",

  receipt: "Payment receipt",

  booking_confirmation: "Booking confirmation",

  service_request_update: "Service request update",

  document_upload_reminder: "Outstanding documents",

  document_rejected: "Document returned",

  document_expiring: "Document expiring",

  document_verified: "Document verified",
}

export const TEMPLATE_KEY_HINTS: Record<TemplateKey, string> = {
  due_payment_reminder:
    "Sent the configured days before an instalment falls due (7, 3, 1 by default).",

  payment_due_today:
    "Sent on the due date itself, while the instalment is still unpaid.",

  payment_overdue:
    "The chase after the due date: day 1, 3, 7, then every configured interval until paid. Carries {late_days} and {late_charge}.",

  payment_received:
    "Sent the moment a payment is recorded, with the receipt number and its link.",

  receipt: "Confirms money received against a customer account.",

  booking_confirmation: "Confirms a booking once it is made.",

  service_request_update:
    "Reports movement on a support ticket, including its resolution.",

  document_upload_reminder:
    "Lists the required papers a customer has not yet filed, sent in bulk or from the checklist.",

  document_rejected:
    "Tells the customer a document was sent back, with the reason the verifier gave.",

  document_expiring:
    "The 60 / 30 / 7-day ladder for a CNIC or other tracked expiry date on a filed document.",

  document_verified:
    "A courtesy that one of the customer's documents cleared review.",
}

export function isTemplateKey(value: unknown): value is TemplateKey {
  return (
    typeof value === "string" &&
    (TEMPLATE_KEYS as readonly string[]).includes(value)
  )
}

/** Body length ceiling. Generous for email, and the same for all channels so one
 * editor behaves identically whatever the tab. */

export const MESSAGE_BODY_MAX = 4000

/** The email subject line, when the channel has one. */

export const MESSAGE_SUBJECT_MAX = 200

/**
 * The substitution tokens.
 *
 * A fixed catalogue rather than free-form mustaches, so a preview can tell the
 * author "this token will never be filled" instead of quietly leaving the braces
 * in the delivered text.
 */

export const PLACEHOLDER_TOKENS = [
  "customer_name",

  "tenant_name",

  "due_amount",

  "due_date",

  "amount_paid",

  "outstanding_balance",

  "booking_reference",

  "unit",

  "project",

  "ticket_id",

  "ticket_status",

  "receipt_number",

  "installment_no",

  "days_before",

  "late_days",

  "late_charge",

  "pay_instructions",

  "receipt_link",

  "document_name",

  "missing_documents",

  "expiry_date",

  "reject_reason",
] as const

export type PlaceholderToken = typeof PLACEHOLDER_TOKENS[number]

export const PLACEHOLDER_TOKEN_LABELS: Record<PlaceholderToken, string> = {
  customer_name: "Customer name",

  tenant_name: "Workspace name",

  due_amount: "Instalment amount due",

  due_date: "Instalment due date",

  amount_paid: "Amount received",

  outstanding_balance: "Outstanding balance",

  booking_reference: "Booking reference",

  unit: "Unit code",

  project: "Project name",

  ticket_id: "Service request id",

  ticket_status: "Service request status",

  receipt_number: "Receipt number",

  installment_no: "Instalment number in the schedule",

  days_before: "Days left before the due date",

  late_days: "Whole days past the due date",

  late_charge: "Late fee standing against the instalment",

  pay_instructions: "How to pay, as the workspace wrote it",

  receipt_link: "Link that opens the receipt",

  document_name: "The document the message is about",

  missing_documents: "The required papers still outstanding, listed",

  expiry_date: "The date a document runs out",

  reject_reason: "Why a verifier sent a document back",
}

/** The literal `{token}` text an author inserts. */

export function placeholderSyntax(token: PlaceholderToken): string {
  return `{${token}}`
}

/** Values a render may be given. Every token is optional: a preview of one
 * purpose legitimately knows nothing about a ticket, and the render reports what
 * is missing rather than demanding a full row. */

export type RenderContext = Partial<Record<PlaceholderToken, unknown>>

export interface RenderedTemplate {
  text: string

  missingTokens: string[]
}

/**
 * Substitutes `{token}` occurrences from `context`.
 *
 * A value is present when it is not null/undefined and its string form is not
 * blank, so an empty string in a form field counts as missing rather than
 * silently erasing the token from the sentence around it. Tokens outside the
 * catalogue are left exactly as written: a stray brace is the author's to notice
 * in the preview, not ours to eat.
 */

export function renderTemplate(
  body: string,

  context: RenderContext,
): RenderedTemplate {
  const missingTokens: string[] = []

  const text = body.replace(/\{([a-z0-9_]+)\}/gi, (whole, token: string) => {
    const key = token.toLowerCase()

    if (!(PLACEHOLDER_TOKENS as readonly string[]).includes(key)) {
      missingTokens.push(token)

      return whole
    }

    const value = context[(key as PlaceholderToken)]

    if (value === null || value === undefined) {
      missingTokens.push(token)

      return whole
    }

    const rendered = String(value).trim()

    if (rendered === "") {
      missingTokens.push(token)

      return whole
    }

    return rendered
  })

  // Report each distinct token once: a body using {due_amount} three times with

  // no value is one problem the author fixes in one place.

  return { text, missingTokens: [...new Set(missingTokens)] }
}

/**
 * Seed bodies, per channel and purpose.
 *
 * SMS and WhatsApp are the same words trimmed to fit a thread a person reads on
 * a phone, with the greeting and sign-off dropped rather than abbreviated — an
 * abbreviated courtesy reads worse than none. The email arms carry a subject
 * because the channel does.
 */

export interface DefaultTemplate {
  subject: string

  body: string
}

export const DEFAULT_TEMPLATES: Record<MessageChannel, Record<TemplateKey, DefaultTemplate>> =
  {
    email: {
      due_payment_reminder: {
        subject: "Payment due on your booking {booking_reference}",

        body: `Dear {customer_name},

Our records show an instalment of {due_amount} for {unit} at {project} is due on {due_date}.

If payment has already been made, please disregard this note — and thank you. Otherwise you can settle it at your earliest convenience to avoid a late fee.

With kind regards,
{tenant_name}`,
      },

      payment_due_today: {
        subject: "Your payment of {due_amount} falls due today",

        body: `Dear {customer_name},

This is a note that instalment {installment_no} for {unit} at {project} — {due_amount} — falls due today, {due_date}.

{pay_instructions}

If payment is already on its way, thank you, and please disregard this note.

With kind regards,
{tenant_name}`,
      },

      payment_overdue: {
        subject:
          "Payment overdue on {booking_reference} — {late_days} days past due",

        body: `Dear {customer_name},

Our records show instalment {installment_no} for {unit} at {project}, due on {due_date}, is now {late_days} days overdue. The amount still outstanding is {due_amount}, and late charges applied so far total {late_charge}.

We understand that dates slip. If there is a problem or a payment plan needs revisiting, please call the number on your booking paperwork — a conversation is always better than a chase.

{pay_instructions}

With kind regards,
{tenant_name}`,
      },

      payment_received: {
        subject: "Received: {amount_paid} — receipt {receipt_number}",

        body: `Dear {customer_name},

Thank you — we have received {amount_paid} against {booking_reference}. Receipt number {receipt_number}.

Your outstanding balance is {outstanding_balance}.

With kind regards,
{tenant_name}`,
      },

      receipt: {
        subject: "Receipt {receipt_number} for {amount_paid}",

        body: `Dear {customer_name},

We have received {amount_paid} against {booking_reference}. Receipt number {receipt_number}.

Your outstanding balance is {outstanding_balance}.

With kind regards,
{tenant_name}`,
      },

      booking_confirmation: {
        subject: "Your booking {booking_reference} is confirmed",

        body: `Dear {customer_name},

Your booking for {unit} at {project} is confirmed under reference {booking_reference}.

A payment schedule will follow, and your documents are available from your account portal.

With kind regards,
{tenant_name}`,
      },

      service_request_update: {
        subject: "Update on your request {ticket_id}",

        body: `Dear {customer_name},

Your service request {ticket_id} is now {ticket_status}.

If anything further is needed, simply reply to your request in the portal and it will reach the team handling it.

With kind regards,
{tenant_name}`,
      },

      document_upload_reminder: {
        subject: "Documents still needed for your booking",

        body: `Dear {customer_name},

To move your booking ahead we still need the following document(s):

{missing_documents}

You can upload them from your account portal, or hand a copy to the officer dealing with you. Thank you.

With kind regards,
{tenant_name}`,
      },

      document_rejected: {
        subject: "One of your documents needs re-submitting",

        body: `Dear {customer_name},

We reviewed your {document_name} and it could not be accepted this time.

Reason: {reject_reason}

Please send a clearer or corrected copy and we will look at it again.

With kind regards,
{tenant_name}`,
      },

      document_expiring: {
        subject: "Your {document_name} is due to expire",

        body: `Dear {customer_name},

The {document_name} we hold on file expires on {expiry_date}. To keep your records current, please provide a renewed copy before that date.

With kind regards,
{tenant_name}`,
      },

      document_verified: {
        subject: "Your {document_name} has been verified",

        body: `Dear {customer_name},

Good news — your {document_name} has cleared our review. No further action is needed for that document.

With kind regards,
{tenant_name}`,
      },
    },

    sms: {
      due_payment_reminder: {
        subject: "",

        body: "{tenant_name}: instalment of {due_amount} for {unit} is due {due_date}. Ref {booking_reference}.",
      },

      payment_due_today: {
        subject: "",

        body: "{tenant_name}: instalment {installment_no} of {due_amount} for {unit} falls due today, {due_date}.",
      },

      payment_overdue: {
        subject: "",

        body: "{tenant_name}: instalment {installment_no} for {unit} is {late_days} days overdue ({due_amount}). Ref {booking_reference}.",
      },

      payment_received: {
        subject: "",

        body: "{tenant_name}: {amount_paid} received. Receipt {receipt_number}. Balance {outstanding_balance}.",
      },

      receipt: {
        subject: "",

        body: "{tenant_name}: {amount_paid} received. Receipt {receipt_number}. Balance {outstanding_balance}.",
      },

      booking_confirmation: {
        subject: "",

        body: "{tenant_name}: booking {booking_reference} for {unit} is confirmed.",
      },

      service_request_update: {
        subject: "",

        body: "{tenant_name}: request {ticket_id} is now {ticket_status}.",
      },

      document_upload_reminder: {
        subject: "",

        body: "{tenant_name}: we still need these documents for your booking: {missing_documents}. Please upload or hand in a copy.",
      },

      document_rejected: {
        subject: "",

        body: "{tenant_name}: your {document_name} was returned — {reject_reason}. Please re-submit.",
      },

      document_expiring: {
        subject: "",

        body: "{tenant_name}: your {document_name} expires {expiry_date}. Please send a renewed copy.",
      },

      document_verified: {
        subject: "",

        body: "{tenant_name}: your {document_name} has been verified. No action needed.",
      },
    },

    whatsapp: {
      due_payment_reminder: {
        subject: "",

        body: "{tenant_name}\n\nAn instalment of {due_amount} for {unit} is due on {due_date}.\nBooking reference: {booking_reference}",
      },

      payment_due_today: {
        subject: "",

        body: "{tenant_name}\n\nInstalment {installment_no} of {due_amount} for {unit} falls due today, {due_date}.",
      },

      payment_overdue: {
        subject: "",

        body: "{tenant_name}\n\nInstalment {installment_no} for {unit} is {late_days} days overdue. Amount outstanding: {due_amount}.\nBooking reference: {booking_reference}",
      },

      payment_received: {
        subject: "",

        body: "{tenant_name}\n\n{amount_paid} received — receipt {receipt_number}.\nOutstanding: {outstanding_balance}",
      },

      receipt: {
        subject: "",

        body: "{tenant_name}\n\n{amount_paid} received — receipt {receipt_number}.\nOutstanding: {outstanding_balance}",
      },

      booking_confirmation: {
        subject: "",

        body: "{tenant_name}\n\nYour booking {booking_reference} for {unit} is confirmed.",
      },

      service_request_update: {
        subject: "",

        body: "{tenant_name}\n\nRequest {ticket_id} is now {ticket_status}.",
      },

      document_upload_reminder: {
        subject: "",

        body: "{tenant_name}\n\nWe still need these documents for your booking:\n{missing_documents}\n\nYou can upload them from your portal or hand a copy to the officer handling your file.",
      },

      document_rejected: {
        subject: "",

        body: "{tenant_name}\n\nYour {document_name} could not be accepted.\nReason: {reject_reason}\n\nPlease send a clearer or corrected copy.",
      },

      document_expiring: {
        subject: "",

        body: "{tenant_name}\n\nYour {document_name} expires on {expiry_date}. Please provide a renewed copy before then.",
      },

      document_verified: {
        subject: "",

        body: "{tenant_name}\n\nYour {document_name} has been verified. No further action is needed.",
      },
    },
  }

/**
 * The Urdu catalogue, same shape, written as Urdu.
 *
 * The courtesy forms a Pakistani officer would actually use (محترم، مع الآداب، براہ کرم),
 * not a word-for-word transposition of the English. Tokens stay ASCII inside RTL text:
 * a name or an amount substituted into an Urdu sentence renders in its own script, which
 * is how these messages read in the wild. `defaultTemplate` is the only reader that
 * should index these directly.
 */

export const DEFAULT_TEMPLATES_UR: Record<MessageChannel, Record<TemplateKey, DefaultTemplate>> =
  {
    email: {
      due_payment_reminder: {
        subject: "{booking_reference} پر واجب الادا قِسط {due_date} کو",

        body: `محترم {customer_name}،

ہماری ریکارڈ کے مطابق {project} میں {unit} کے لیے {due_amount} کی قِسط {due_date} کو واجب الادا ہے۔

اگر آپ نے ادائیگی پہلے ہی کر دی ہے تو براہ کرم یہ پیغام نظر انداز فرمائیں — اور شکریہ۔ ورنہ براہ کرم تاخیر کے اضافی زر سے بچنے کے لیے اپنی قِسط وقت پر ادا کر دیں۔

{pay_instructions}

مع الآداب،
{tenant_name}`,
      },

      payment_due_today: {
        subject: "آج {due_date} کو آپ کی قِسط {due_amount} واجب الادا ہے",

        body: `محترم {customer_name}،

یاد دہانی ہے کہ {project} میں {unit} کے لیے قِسط نمبر {installment_no} — رقم {due_amount} — آج {due_date} کو واجب الادا ہے۔

{pay_instructions}

اگر ادائیگی ہو چکی ہے تو شکریہ، یہ پیغام نظر انداز فرمائیں۔

مع الآداب،
{tenant_name}`,
      },

      payment_overdue: {
        subject: "{booking_reference} کی قِسط {late_days} دن سے تاخیر میں",

        body: `محترم {customer_name}،

ہماری ریکارڈ کے مطابق {project} میں {unit} کے لیے قِسط نمبر {installment_no}، جو {due_date} کو واجب الادا تھی، اب {late_days} دن سے تاخیر میں ہے۔ باقی رقم {due_amount} ہے اور اب تک تاخیر کے اضافی زر {late_charge} لاگو ہو چکے ہیں۔

ہم سمجھتے ہیں کہ کبھی تاریخیں بدل جاتی ہیں۔ اگر کوئی مسئلہ ہے یا ادائیگی کا شیڈول دوبارہ دیکھنا ہے تو بکنگ کے کاغذات پر دیے گئے نمبر پر رابطہ کریں — بات چیت مسلسل پیغامات سے بہتر ہے۔

{pay_instructions}

مع الآداب،
{tenant_name}`,
      },

      payment_received: {
        subject: "وصول ہوئی: {amount_paid} — رسید {receipt_number}",

        body: `محترم {customer_name}،

شکریہ — ہمیں {booking_reference} کے مقابل میں {amount_paid} موصول ہو گئے ہیں۔ رسید نمبر {receipt_number}۔

آپ کی باقی رقم {outstanding_balance} ہے۔

مع الآداب،
{tenant_name}`,
      },

      receipt: {
        subject: "رسید {receipt_number} — {amount_paid} کی وصولی",

        body: `محترم {customer_name}،

آپ کے کھاتے پر {amount_paid} وصول ہو گئے ہیں۔ رسید نمبر {receipt_number}۔

باقی رقم: {outstanding_balance}

مع الآداب،
{tenant_name}`,
      },

      booking_confirmation: {
        subject: "آپ کی بکنگ {booking_reference} تصدیق ہو گئی",

        body: `محترم {customer_name}،

{project} میں {unit} کے لیے آپ کی بکنگ حوالہ نمبر {booking_reference} کے تحت تصدیق ہو گئی ہے۔

ادائیگی کا شیڈول بعد میں بھیجا جائے گا اور آپ کے دستاویزات پورٹل پر دستیاب ہیں۔

مع الآداب،
{tenant_name}`,
      },

      service_request_update: {
        subject: "آپ کی درخواست {ticket_id} کی صورتحال",

        body: `محترم {customer_name}،

آپ کی سروس درخواست {ticket_id} کی موجودہ حیثیت {ticket_status} ہے۔

اگر مزید کوئی ضرورت ہو تو پورٹل میں اپنی درخواست کا جواب بھیجیں، وہ متعلقہ ٹیم تک پہنچ جائے گی۔

مع الآداب،
{tenant_name}`,
      },

      document_upload_reminder: {
        subject: "آپ کی بکنگ کے لیے درکار دستاویزات",

        body: `محترم {customer_name},

آپ کی بکنگ مکمل کرنے کے لیے ہمیں درج ذیل دستاویزات درکار ہیں:

{missing_documents}

آپ انہیں اپنے پورٹل سے اپ لوڈ کر سکتے ہیں یا متعلقہ آفیسر کے حوالے کر سکتے ہیں۔ شکریہ۔

مع الآداب،
{tenant_name}`,
      },

      document_rejected: {
        subject: "آپ کی ایک دستاویز واپس بھیجی گئی ہے",

        body: `محترم {customer_name},

ہم نے آپ کی {document_name} کا جائزہ لیا اور یہ اس بار قبول نہیں ہو سکی۔

وجہ: {reject_reason}

براہ کرم واضح یا درست کاپی دوبارہ بھیجیں، ہم دوبارہ جائزہ لیں گے۔

مع الآداب،
{tenant_name}`,
      },

      document_expiring: {
        subject: "آپ کی {document_name} کی میعاد ختم ہونے والی ہے",

        body: `محترم {customer_name},

ہمارے ریکارڈ میں موجود آپ کی {document_name} کی میعاد {expiry_date} کو ختم ہو رہی ہے۔ ریکارڈ کو فعال رکھنے کے لیے براہ کرم اس تاریخ سے پہلے تجدد کاپی فراہم کریں۔

مع الآداب،
{tenant_name}`,
      },

      document_verified: {
        subject: "آپ کی {document_name} تصدیق ہو گئی ہے",

        body: `محترم {customer_name},

خوشی کی بات — آپ کی {document_name} ہمارے جائزے سے گذر گئی ہے۔ اس دستاویز کے لیے مزید کوئی ضرورت نہیں۔

مع الآداب،
{tenant_name}`,
      },
    },

    sms: {
      due_payment_reminder: {
        subject: "",

        body: "{tenant_name}: {unit} کی قِسط {due_amount} {due_date} کو واجب الادا۔ حوالہ: {booking_reference}۔",
      },

      payment_due_today: {
        subject: "",

        body: "{tenant_name}: {unit} کی قِسط {installment_no} ({due_amount}) آج {due_date} کو واجب الادا ہے۔",
      },

      payment_overdue: {
        subject: "",

        body: "{tenant_name}: {unit} کی قِسط {installment_no} {late_days} دن سے تاخیر میں ({due_amount})۔ حوالہ: {booking_reference}۔",
      },

      payment_received: {
        subject: "",

        body: "{tenant_name}: {amount_paid} وصول۔ رسید {receipt_number}۔ باقی رقم: {outstanding_balance}۔",
      },

      receipt: {
        subject: "",

        body: "{tenant_name}: {amount_paid} وصول۔ رسید نمبر {receipt_number}۔ باقی رقم {outstanding_balance}۔",
      },

      booking_confirmation: {
        subject: "",

        body: "{tenant_name}: {unit} کی بکنگ {booking_reference} کے ساتھ تصدیق ہو گئی۔",
      },

      service_request_update: {
        subject: "",

        body: "{tenant_name}: درخواست {ticket_id} کی حیثیت: {ticket_status}۔",
      },

      document_upload_reminder: {
        subject: "",

        body: "{tenant_name}: آپ کی بکنگ کے لیے یہ دستاویزات درکار ہیں: {missing_documents}۔ براہ کرم اپ لوڈ کریں یا آفیسر کے حوالے کریں۔",
      },

      document_rejected: {
        subject: "",

        body: "{tenant_name}: آپ کی {document_name} واپس بھیجی گئی — {reject_reason}۔ براہ کرم دوبارہ بھیجیں۔",
      },

      document_expiring: {
        subject: "",

        body: "{tenant_name}: آپ کی {document_name} کی میعاد {expiry_date} کو ختم ہو رہی ہے۔ تجدد کاپی بھیجیں۔",
      },

      document_verified: {
        subject: "",

        body: "{tenant_name}: آپ کی {document_name} تصدیق ہو گئی ہے۔ کوئی ضرورت نہیں۔",
      },
    },

    whatsapp: {
      due_payment_reminder: {
        subject: "",

        body: "{tenant_name}\n\n{project} میں {unit} کے لیے {due_amount} کی قِسط {due_date} کو واجب الادا ہے۔\nحوالہ: {booking_reference}",
      },

      payment_due_today: {
        subject: "",

        body: "{tenant_name}\n\n{unit} کے لیے قِسط {installment_no} ({due_amount}) آج {due_date} کو واجب الادا ہے۔",
      },

      payment_overdue: {
        subject: "",

        body: "{tenant_name}\n\n{unit} کے لیے قِسط {installment_no} {late_days} دن سے تاخیر میں ہے۔ باقی رقم: {due_amount}\nحوالہ: {booking_reference}",
      },

      payment_received: {
        subject: "",

        body: "{tenant_name}\n\n{amount_paid} موصول — رسید {receipt_number}۔\nباقی رقم: {outstanding_balance}",
      },

      receipt: {
        subject: "",

        body: "{tenant_name}\n\n{amount_paid} وصول — رسید {receipt_number}۔\nباقی رقم: {outstanding_balance}",
      },

      booking_confirmation: {
        subject: "",

        body: "{tenant_name}\n\n{unit} کے لیے آپ کی بکنگ {booking_reference} کے تحت تصدیق ہو گئی ہے۔",
      },

      service_request_update: {
        subject: "",

        body: "{tenant_name}\n\nدرخواست {ticket_id} کی حیثیت: {ticket_status}۔",
      },

      document_upload_reminder: {
        subject: "",

        body: "{tenant_name}\n\nآپ کی بکنگ کے لیے درج ذیل دستاویزات درکار ہیں:\n{missing_documents}\n\nآپ انہیں اپنے پورٹل سے اپ لوڈ کر سکتے ہیں یا متعلقہ آفیسر کے حوالے کر سکتے ہیں۔",
      },

      document_rejected: {
        subject: "",

        body: "{tenant_name}\n\nآپ کی {document_name} قبول نہیں ہو سکی۔\nوجہ: {reject_reason}\n\nبراہ کرم واضح یا درست کاپی دوبارہ بھیجیں۔",
      },

      document_expiring: {
        subject: "",

        body: "{tenant_name}\n\nآپ کی {document_name} کی میعاد {expiry_date} کو ختم ہو رہی ہے۔ براہ کرم اس سے پہلے تجدد کاپی فراہم کریں۔",
      },

      document_verified: {
        subject: "",

        body: "{tenant_name}\n\nآپ کی {document_name} تصدیق ہو گئی ہے۔ مزید کوئی ضرورت نہیں۔",
      },
    },
  }

/** The shipped default wording for one (language, channel, purpose). */

export function defaultTemplate(
  language: MessageLanguage,

  channel: MessageChannel,

  key: TemplateKey,
): DefaultTemplate {
  return language === "ur"
    ? DEFAULT_TEMPLATES_UR[channel][key]
    : DEFAULT_TEMPLATES[channel][key]
}

/** One stored template as the settings panel reads it. */

export interface MessageTemplate {
  channel: MessageChannel

  templateKey: TemplateKey

  language: MessageLanguage

  subject: string

  body: string

  enabled: boolean

  updatedAt: string
}

/** A template plus the catalogue the editor renders around it. */

export interface CommunicationsView {
  templates: MessageTemplate[]

  channels: MessageChannel[]

  keys: TemplateKey[]

  languages: MessageLanguage[]

  tokens: PlaceholderToken[]

  canEdit: boolean
}

/**
 * One row of the reminder dry run: the instalment that would be written to, and
 * the text that would go out. Produced by `runDuePaymentReminders`, which sends
 * nothing.
 */

export interface RenderedReminder {
  customerId: string

  customerName: string

  bookingId: string

  bookingReference: string

  unitCode: string

  projectName: string

  installmentId: string

  installmentNumber: number

  dueDate: string

  dueAmount: number

  outstandingBalance: number

  currency: string

  daysUntilDue: number

  channel: MessageChannel

  subject: string

  body: string

  missingTokens: string[]
}
