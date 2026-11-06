import { type Localized } from "@/features/marketing/content"

/**
 * Draft legal copy for the public marketing site. Everything is marked as a draft
 * in the UI and lives here so it can be edited without touching layout. This is
 * boilerplate, not legal advice — it must be reviewed by a lawyer before publishing.
 */

export interface LegalSection {
  heading: Localized
  body: Localized
}

export const privacySections: LegalSection[] = [
  {
    heading: {
      en: "What we collect",
      ur: "ہم کیا جمع کرتے ہیں",
    },
    body: {
      en: "We collect the account and workspace details you provide when you sign up (company name, your name, work email and phone) and the business data you choose to store in DeedOrbit — projects, units, customers, bookings, payments, documents and messages.",
      ur: "سائن اپ کے دوران آپ دی گئی تفصیلات (کمپنی کا نام، آپ کا نام، ای میل اور فون) اور آپ جو کاروباری ڈیٹا محفوظ کرتے ہیں جیسے پروجیکٹ، یونٹ، کسٹمر، بکنگ، ادائیگیاں، دستاویزات اور پیغامات۔",
    },
  },
  {
    heading: {
      en: "How we use it",
      ur: "اس کا استعمال کیسے",
    },
    body: {
      en: "Your data is used only to provide the service to you: running your workspace, generating receipts and reminders, producing reports, and keeping an audit trail. We do not sell your data.",
      ur: "آپ کا ڈیٹا صرف خدمت فراہم کرنے کے لیے: ورک اسپیس چلانا، رسیدیں اور یاد دہانیاں بنانا، رپورٹس، اور آڈٹ ریکارڈ۔ ہم آپ کا ڈیٹا نہیں بیچتے۔",
    },
  },
  {
    heading: {
      en: "Tenant isolation and security",
      ur: "ٹیننٹ علیحدگی اور سیکیورٹی",
    },
    body: {
      en: "Each company is an isolated tenant. Access is role-based, sensitive document fields are encrypted at rest and masked by default, and every reveal or download is audit-logged. We use only essential cookies to keep you signed in.",
      ur: "ہر کمپنی الگ ٹیننٹ ہے۔ رسائی رول پر مبنی، حساس فیلڈز خفیہ اور چھپے ہوئے، اور ہر ظاہر/ڈاؤن لوڈ آڈٹ لاگ۔ ہم صرف ضروری کوکی استعمال کرتے ہیں۔",
    },
  },
  {
    heading: {
      en: "Retention and export",
      ur: "حفظ اور ایکسپورٹ",
    },
    body: {
      en: "You own your data. You can export it at any time and, on request, ask us to delete it from your tenant. Backups are retained for a limited period to support recovery, then removed.",
      ur: "ڈیٹا آپ کا ہے۔ آپ کسی وقت ایکسپورٹ کر سکتے ہیں اور درخواست پر حذف کروا سکتے ہیں۔ ریکوری کے لیے بیک اپ عرصہ تک رہتے ہیں، پھر ہٹ جاتے ہیں۔",
    },
  },
  {
    heading: {
      en: "Contact",
      ur: "رابطہ",
    },
    body: {
      en: "For any privacy question or request, contact the DeedOrbit operator using the email listed on this site.",
      ur: "کوئی بھی پرائیویسی سوال یا درخواست کے لیے سائٹ پر دیے گئے ای میل سے رابطہ کریں۔",
    },
  },
]

export const termsSections: LegalSection[] = [
  {
    heading: {
      en: "The service",
      ur: "سروس",
    },
    body: {
      en: "DeedOrbit is a cloud real-estate ERP provided on a subscription or trial basis. Availability, features and limits may change as the product evolves.",
      ur: "DeedOrbit ایک کلاؤڈ ریئل اسٹیٹ ERP ہے جو سبسکرپشن یا ٹرائل پر دیا جاتا ہے۔ دستیابی اور خصوصیات ترقی کے ساتھ بدل سکتی ہیں۔",
    },
  },
  {
    heading: {
      en: "Your account",
      ur: "آپ کا اکاؤنٹ",
    },
    body: {
      en: "You are responsible for keeping your credentials secure and for the activity that happens under your workspace. Notify us promptly of any suspected unauthorized access.",
      ur: "اپنے Credentials کی حفاظت اور ورک اسپیس میں ہونے والی سرگرمی کی ذمہ داری آپ کی ہے۔ غیر مجاز رسائی کا شبہ ہو تو فوری اطلاع دیں۔",
    },
  },
  {
    heading: {
      en: "Acceptable use",
      ur: "قابلِ قبول استعمال",
    },
    body: {
      en: "You agree to use the service lawfully, to store only data you have the right to process, and not to disrupt, reverse-engineer or overload the platform.",
      ur: "آپ قانونی استعمال، صرف جائز ڈیٹا محفوظ کرنا، اور پلیٹ فارم میں خلل/ریورس انجینئرنگ/اوور لوڈ نہ کرنے پر متفق ہیں۔",
    },
  },
  {
    heading: {
      en: "Fees and trial",
      ur: "فیس اور ٹرائل",
    },
    body: {
      en: "Paid plans are billed according to the price shown at signup, exclusive of applicable taxes. A free trial, where offered, does not require a card and does not auto-renew into a paid plan without your action.",
      ur: "تصدیق شدہ قیمت پر مبنی بل، ٹیکس کے علاوہ۔ مفت ٹرائل (جہاں ہو) کارڈ مانگتا نہیں اور آپ کے عمل کے بغیر خودکار طور پر ادائیہ پلان نہیں بنتا۔",
    },
  },
  {
    heading: {
      en: "Limitation of liability",
      ur: "ذمہ داری کی تحدید",
    },
    body: {
      en: "The service is provided “as is”. To the extent permitted by law, DeedOrbit is not liable for indirect or consequential losses arising from use of the service.",
      ur: "سروس “جیسے ہے” فراہم ہوتی ہے۔ قانون کی اجازت کے تحت، DeedOrbit استعمال سے ہونے والے بالواسطہ نقصانات کا ذمہ دار نہیں۔",
    },
  },
]
