/**
 * DeedOrbit marketing site — single content & config file.
 *
 * Every headline, paragraph, price, image path and contact string on the public
 * landing / auth / legal pages lives HERE, so the copy can be rewritten without
 * touching a layout component. Each user-facing string is a `Localized` pair
 * (English + Urdu); the Urdu half renders right-to-left through the language
 * toggle. Set `site.langDefault` to change the opening language.
 *
 * ICONS are stored as Lucide *names* (strings) and resolved in `icons.tsx`, which
 * keeps this file free of imports and safe to edit.
 *
 * HONESTY RULE (enforced across this feature): never place a fabricated number,
 * customer logo, review, award or statistic in the config. Anything the owner has
 * not provided stays behind a `show: false` / `placeholder: true` flag so the
 * layout renders a labelled slot instead of a made-up value.
 */

export interface Localized {
  en: string
  ur: string
}

/** Shorthand so the copy below stays readable. */
const L = (en: string, ur: string): Localized => ({ en, ur })

export const content = {
  site: {
    // Editable brand + SEO defaults.
    name: "DeedOrbit",
    url: "https://deedorbit.vercel.app",
    langDefault: "en" as "en" | "ur",
    themeColor: "#0f172a",
    title: L(
      "DeedOrbit — Real Estate ERP for Developers & Housing Societies",
      "ڈیڈ آربٹ — ڈویلپرز اور ہاؤسنگ سوسائٹیز کے لیے ریئل اسٹیٹ ERP",
    ),
    description: L(
      "One secure, multi-tenant platform for inventory, bookings, installments, document verification and recovery. Built for Pakistani real estate teams.",
      "انوینٹری، بکنگ، اقساط، دستاویزی تصدیق اور وصولی کے لیے ایک محفوظ، ملٹی ٹیننٹ پلیٹ فارم۔ پاکستانی ریئل اسٹیٹ ٹیموں کے لیے بنایا گیا۔",
    ),
    ogImage: "/media/og-cover.jpg",
  },

  media: {
    heroVideo: "/media/hero.mp4",
    heroVideoWebm: "/media/hero.webm",
    heroPoster: "/media/hero-poster.jpg",
    loginSide: "/media/login-side.jpg",
    gallery: {
      plots: "/media/plots-1.jpg",
      houses: "/media/houses-1.jpg",
      apartments: "/media/apartments-1.jpg",
      shops: "/media/shops-1.jpg",
      towers: "/media/towers-1.jpg",
      commercial: "/media/commercial-1.jpg",
    },
    // Optional short clips; empty means "no clip — show the still image".
    clips: {
      towers: "",
      commercial: "",
    },
  },

  contact: {
    email: "sales@deedorbit.com",
    phone: "+92 000 0000000",
    phoneHref: "+920000000000",
    address: L("Karachi · Lahore · Islamabad, Pakistan", "کراچی · لاہور · اسلام آباد، پاکستان"),
    whatsapp: "",
    social: {
      linkedin: "",
      facebook: "",
      x: "",
      youtube: "",
    },
  },

  nav: {
    links: [
      { id: "features", label: L("Features", "خصوصیات"), href: "#/features" },
      {
        id: "how",
        label: L("How it Works", "کیسے کام کرتا ہے"),
        href: "#/how",
      },
      { id: "pricing", label: L("Pricing", "قیمت"), href: "#/pricing" },
      { id: "faq", label: L("FAQ", "سوالات"), href: "#/faq" },
      { id: "contact", label: L("Contact", "رابطہ"), href: "#/contact" },
    ],
    signIn: L("Sign In", "سائن اِن"),
    signUp: L("Start Free Trial", "مفت ٹرائل شروع کریں"),
    dashboard: L("Go to Dashboard", "ڈیش بورڈ پر جائیں"),
    signOut: L("Sign Out", "سائن آؤٹ"),
  },

  hero: {
    eyebrow: L("Real Estate ERP · Pakistan", "ریئل اسٹیٹ ERP · پاکستان"),
    headline: L(
      "From Booking to Recovery. Every Deed, in Orbit.",
      "بکنگ سے وصولی تک۔ ہر دستاویز، منظم اور محفوظ۔",
    ),
    sub: L(
      "Manage inventory, sales, installments, documents and recovery in one place — multi-tenant, secure, and in Urdu or English.",
      "انوینٹری، سیلز، اقساط، دستاویزات اور وصولی ایک جگہ منظم کریں — ملٹی ٹیننٹ، محفوظ، اور اردو یا انگریزی میں۔",
    ),
    ctaPrimary: L("Start Free Trial", "مفت ٹرائل شروع کریں"),
    ctaSecondary: L("Book a Demo", "ڈیمو بک کریں"),
    scroll: L("Scroll to explore", "آگے دیکھیں"),
    trust: [
      {
        icon: "ShieldCheck",
        label: L("Multi-tenant & secure", "ملٹی ٹیننٹ اور محفوظ"),
      },
      { icon: "Languages", label: L("Urdu & English", "اردو اور انگریزی") },
      {
        icon: "CalendarClock",
        label: L("Installment tracking", "اقساط کی نگرانی"),
      },
    ],
    orbitCards: [
      L("Unit Booked", "یونٹ بک ہوا"),
      L("Payment Received", "ادائیگی موصول"),
      L("Installment Due", "قسط مقرر"),
      L("Document Verified", "دستاویز تصدیق شدہ"),
    ],
    sceneFallbackNote: L(
      "Illustration shown for reduced-motion or low-power devices.",
      "کم حرکت یا کم طاقت والے آلات کے لیے تصویر دکھائی گئی ہے۔",
    ),
  },

  trustStrip: {
    heading: L(
      "Built for developers, housing societies and real estate agencies",
      "ڈویلپرز، ہاؤسنگ سوسائٹیز اور ریئل اسٹیٹ ایجنسیوں کے لیے بنایا گیا",
    ),
    items: [
      { icon: "Building2", label: L("Developers", "ڈویلپرز") },
      {
        icon: "MapPin",
        label: L("Housing societies", "ہاؤسنگ سوسائٹیز"),
      },
      {
        icon: "Users",
        label: L("Sales agencies", "سیلز ایجنسیاں"),
      },
      {
        icon: "HardHat",
        label: L("Construction firms", "کنسٹرکشن فرمز"),
      },
    ],
    placeholderNote: L(
      "Add customer logos or a client count in content.ts when you have permission to show them.",
      "اجازت ہونے پر content.ts میں کسٹمر لوگو یا گاہک تعداد شامل کریں۔",
    ),
  },

  problem: {
    eyebrow: L("The reality today", "آج کی حقیقت"),
    title: L(
      "Stop running your real estate business on registers and spreadsheets.",
      "اپنا ریئل اسٹیٹ کاروبار register اور spreadsheet پر چلانا بند کریں۔",
    ),
    pains: [
      {
        icon: "FileWarning",
        title: L("Lost installment records", "کھوئی ہوئی اقساط کی ریکارڈز"),
        body: L(
          "Dates, partial payments and balances scatter across files and phones.",
          "تاریخیں، جزوی ادائیگیاں اور بیلنس فائلوں اور فونوں میں بکھر جاتے ہیں۔",
        ),
      },
      {
        icon: "TrendingDown",
        title: L("Missed recoveries", "چھوٹی ہوئی وصولیاں"),
        body: L(
          "Nobody is nudged on a due date, so receivables quietly slip.",
          "مقررہ دن کو کوئی یاد نہیں دیتا، تو وصولیاں آہستہ رک جاتی ہیں۔",
        ),
      },
      {
        icon: "FolderSearch",
        title: L("Scattered documents", "بکھری ہوئی دستاویزات"),
        body: L(
          "CNICs, files and approvals sit with people, not in one audited place.",
          "شناختی کارڈ، فائلیں اور منظری لوگوں کے پاس رہتی ہیں، ایک محفوظ جگہ نہیں۔",
        ),
      },
    ],
    solution: {
      title: L("DeedOrbit answers it", "ڈیڈ آربٹ کا جواب"),
      body: L(
        "One workspace where every unit, buyer, payment, document and approval lives on a single, tenant-isolated, audited ledger.",
        "ایک ورک اسپیس جہاں ہر یونٹ، خریدار، ادائیگی، دستاویز اور منظری ایک ہی، الگ اور آڈٹ شدہ لیجر پر ہوتی ہے۔",
      ),
      points: [
        L("Every installment dated, tracked and reconciled", "ہر قسط تاریخ کے ساتھ، نظر میں اور ملان شدہ"),
        L("Automatic due reminders by SMS, WhatsApp, email", "SMS، واٹس ایپ، ای میل سے خودکار یاد دہانی"),
        L("Documents encrypted, verified, and audit-logged", "دستاویزات خفیہ، تصدیق شدہ اور آڈٹ لاگ کے ساتھ"),
      ],
    },
  },

  features: {
    eyebrow: L("What's inside", "اندر کیا ہے"),
    title: L("Everything the business touches, in one system", "کاروبار جو چھوتا ہے، سب ایک نظام میں"),
    cards: [
      {
        icon: "Layers",
        title: L("Inventory & Property Categories", "انوینٹری اور پراپرٹی کیٹگری"),
        body: L(
          "Plots, flats, shops and towers with Marla sizing, categories and live unit statuses.",
          "پلاٹ، فلیٹ، دکان اور ٹاور، مرلہ سائز، کیٹگری اور لائیو اسٹیٹس کے ساتھ۔",
        ),
      },
      {
        icon: "UserPlus",
        title: L("Leads & Sales Pipeline", "لیڈز اور سیلز پائپ لائن"),
        body: L(
          "Capture enquiries and move each buyer through stages to a signed booking.",
          "تفتیش جمع کریں اور ہر خریدار کو مراحل سے بکنگ تک لے جائیں۔",
        ),
      },
      {
        icon: "FileSignature",
        title: L("Bookings & Approvals", "بکنگ اور منظری"),
        body: L(
          "Book a unit, set the plan, and route every exception through maker-checker approvals.",
          "یونٹ بک کریں، پلان طے کریں، ہر استثنیٰ کو منظری سے گزاریں۔",
        ),
      },
      {
        icon: "CalendarClock",
        title: L("Installment Tracking", "اقساط کی نگرانی"),
        body: L(
          "Down-payment plus a schedule of monthly or quarterly installments, auto-balanced.",
          "डाउन پیمنٹ کے ساتھ ماہانہ یا سہ ماہی اقساط کا خودکار شیڈول۔",
        ),
      },
      {
        icon: "BellRing",
        title: L("Automatic Reminders", "خودکار یاد دہانیاں"),
        body: L(
          "SMS, WhatsApp and email nudges on due dates and expiring documents.",
          "مقررہ دن اور ختم ہوتی دستاویزات پر SMS، واٹس ایپ اور ای میل۔",
        ),
      },
      {
        icon: "ShieldCheck",
        title: L("Documents & Verification", "دستاویزات اور تصدیق"),
        body: L(
          "CNIC OCR, duplicate checks, expiry alerts and a booking block until verified.",
          "CNIC OCR، ڈپلیکیٹ چیک، میعاد الرٹ اور تصدیق تک بکنگ بلاک۔",
        ),
      },
      {
        icon: "CircleDollarSign",
        title: L("Recovery & Collections", "وصولی اور کلیکشن"),
        body: L(
          "Receipts, a customer ledger, late fees and a live view of every outstanding.",
          "رسیدیں، کسٹمر لیجر، لیٹ فیز اور ہر باقی رقم کا لائیو نقشہ۔",
        ),
      },
      {
        icon: "Sparkles",
        title: L("AI Sales Insights & Pivots", "AI سیلز بصیرت اور پوٹ"),
        body: L(
          "Ask questions in plain words and read pivot charts of sales, dues and occupancy.",
          "سادہ الفاظ میں سوال کریں، سیلز، بقایا اور اشغال کا چارٹ پڑھیں۔",
        ),
      },
    ],
    showcases: [
      {
        icon: "CircleDollarSign",
        title: L("See money move, day by day", "پیسے کی ہلچل، دن بہ دن"),
        body: L(
          "Collections, dues and recovery roll up live so finance and sales read the same numbers.",
          "کلیکشن، بقایا اور وصولی لائیو جمع ہوتی ہیں، مالیا اور سیلز ایک ہی عدد پڑھتے ہیں۔",
        ),
        bullets: [
          L("Installment plans with remainder-safe scheduling", "باقی رقم درست اقساط والے پلان"),
          L("Late fees, refunds and cancellation rules enforced", "لیٹ فیز، رقم واپسی اور منسوخی کے اصول"),
          L("Chart of accounts, journal and month-closing", "اکاؤنٹس چارٹ، جرنل اور ماہانہ کلوزنگ"),
        ],
        screenshotSlot: "collections",
      },
      {
        icon: "ShieldCheck",
        title: L("Verify every buyer before you commit", "ہر خریدار کو باندھنے سے پہلے تصدیق کریں"),
        body: L(
          "The document queue blocks a booking until identity and files clear, and logs any override.",
          "دستاویزی قطار تصدیق تک بکنگ روکتی ہے اور کسی override کو لاگ کرتی ہے۔",
        ),
        bullets: [
          L("CNIC OCR with duplicate identity flags", "CNIC OCR اور ڈپلیکیٹ شناخت کی علامت"),
          L("Encryption at rest, masking, reveal audit", "مخفی ذخیرہ، چھپائی، اور ظاہر کرنے کا آڈٹ"),
          L("Signed, short-lived links for file access", "فائل رسائی کے لیے دستخط شدہ، عارضی لنک"),
        ],
        screenshotSlot: "verification",
      },
    ],
  },

  preview: {
    eyebrow: L("The dashboard", "ڈیش بورڈ"),
    title: L("A look inside the workspace", "ورک اسپیس کے اندر کی جھلک"),
    note: L(
      "Sample view for illustration — figures shown here are not real customer data.",
      "تصویر کے لیے نمونہ — یہاں دکھائی گئی اعداد حقیقی کسٹمر ڈیٹا نہیں۔",
    ),
    callouts: [
      {
        icon: "TrendingUp",
        label: L("Total sales", "کل فروخت"),
        hint: L("Across all projects", "تمام پروجیکٹس میں"),
      },
      {
        icon: "AlertTriangle",
        label: L("Overdue recovery", "مؤخر وصولی"),
        hint: L("Dues past their date", "مقررہ تاریخ گزر گئی"),
      },
      {
        icon: "Layers",
        label: L("Inventory status", "انوینٹری حالت"),
        hint: L("Available · Booked · Sold", "دستیاب · بک · فروخت شدہ"),
      },
    ],
  },

  gallery: {
    eyebrow: L("What you sell", "آپ کیا بیچتے ہیں"),
    title: L("One platform for every kind of property", "ہر قسم کی پراپرٹی کے لیے ایک پلیٹ فارم"),
    items: [
      { key: "plots", label: L("Plots", "پلاٹ"), kind: "image" as const },
      { key: "houses", label: L("Houses", "گھر"), kind: "image" as const },
      {
        key: "apartments",
        label: L("Apartments", "اپارٹمنٹ"),
        kind: "image" as const,
      },
      { key: "shops", label: L("Shops", "دکانیں"), kind: "image" as const },
      { key: "towers", label: L("Towers", "ٹاورز"), kind: "image" as const },
      {
        key: "commercial",
        label: L("Commercial", "کمرشل"),
        kind: "image" as const,
      },
    ],
    lightboxHint: L("Click to view · press Esc to close", "دیکھنے کے لیے کلک · بند کرنے کو Esc"),
  },

  how: {
    eyebrow: L("How it works", "کیسے کام کرتا ہے"),
    title: L("Live in four steps", "چار قدموں میں شروع"),
    steps: [
      {
        title: L("Create your project & inventory", "اپنا پروجیکٹ اور انوینٹری بنائیں"),
        body: L(
          "Add projects, blocks and units with categories, Marla sizing and prices.",
          "پروجیکٹ، بلاک اور یونٹ شامل کریں، کیٹگری، مرلہ اور قیمت کے ساتھ۔",
        ),
      },
      {
        title: L("Add customers & bookings", "گاہک اور بکنگ شامل کریں"),
        body: L(
          "Convert a lead to a buyer, book a unit, and set the installment plan.",
          "لیڈ کو خریدار بنائیں، یونٹ بک کریں، اور اقساط کا پلان طے کریں۔",
        ),
      },
      {
        title: L("Track installments & reminders", "اقساط اور یاد دہانی دیکھیں"),
        body: L(
          "Record payments, generate receipts and send automatic due reminders.",
          "ادائیگیاں درج کریں، رسیدیں بنائیں، خودکار یاد دہانیاں بھیجیں۔",
        ),
      },
      {
        title: L("Analyze & grow with AI insights", "AI بصیرت سے تجزیہ اور واڑھ"),
        body: L(
          "Read dashboards and pivot reports, and ask the assistant plain questions.",
          "ڈیش بورڈ اور پوٹ رپورٹ پڑھیں، اور اسسٹنٹ سے سادہ سوال کریں۔",
        ),
      },
    ],
  },

  numbers: {
    eyebrow: L("Platform capabilities", "پلیٹ فارم کی صلاحیتیں"),
    title: L("Built to scale with your portfolio", "اپنی پراپرٹی کے ساتھ بڑھنے کے لیے تیار"),
    note: L(
      "These are platform capabilities, not customer metrics.",
      "یہ پلیٹ فارم کی صلاحیتیں ہیں، کسٹمر اعداد نہیں۔",
    ),
    items: [
      { value: "8+", label: L("Connected modules", "منسلک ماڈیول") },
      { value: "∞", label: L("Installment plans", "اقساط کے پلان") },
      { value: "2", label: L("Languages (Urdu / English)", "زبانیں (اردو / انگریزی)") },
      { value: "24/7", label: L("Cloud access", "کلاؤڈ رسائی") },
    ],
  },

  pricing: {
    eyebrow: L("Pricing", "قیمت"),
    title: L("Plans that grow with your book of business", "اپنے کاروبار کے ساتھ بڑھنے والے پلان"),
    toggleMonthly: L("Monthly", "ماہانہ"),
    toggleYearly: L("Yearly", "سالانہ"),
    yearlyBadge: L("2 months free", "دو ماہ مفت"),
    currency: "PKR",
    taxNote: L(
      "All prices are exclusive of applicable taxes.",
      "تمام قیمتوں میں لاگو ٹیکس شامل نہیں۔",
    ),
    trialNote: L(
      "Every plan starts with a 14-day free trial. No card required.",
      "ہر پلان 14 دن کی مفت ٹرائل سے شروع ہوتا ہے۔ کارڈ کی ضرورت نہیں۔",
    ),
    popular: L("Most popular", "سب سے مقبول"),
    plans: [
      {
        id: "starter",
        name: L("Starter", "اسٹارٹر"),
        tagline: L("Single project, getting organized", "ایک پروجیکٹ، نظم و ضبط"),
        monthly: 15000,
        yearly: 150000,
        features: [
          L("1 project · up to 100 units", "1 پروجیکٹ · 100 تک یونٹ"),
          L("Bookings & installment plans", "بکنگ اور اقساط کے پلان"),
          L("Payments, receipts & ledger", "ادائیگیاں، رسیدیں اور لیجر"),
          L("Document verification queue", "دستاویزی تصدیق کی قطار"),
          L("Email & WhatsApp reminders", "ای میل اور واٹس ایپ یاد دہانی"),
        ],
        cta: L("Start Free Trial", "مفت ٹرائل شروع کریں"),
      },
      {
        id: "growth",
        name: L("Growth", "گروتھ"),
        tagline: L("Multiple projects and a sales team", "متعدد پروجیکٹ اور سیلز ٹیم"),
        monthly: 35000,
        yearly: 350000,
        popular: true,
        features: [
          L("Everything in Starter", "اسٹارٹر کی سب کچھ"),
          L("Unlimited projects & units", "لاحد پروجیکٹ اور یونٹ"),
          L("Leads, agents & dealers", "لیڈز، ایجنٹ اور ڈیلر"),
          L("Approvals, roles & branch access", "منظری، رولز اور برانچ رسائی"),
          L("Customer portal", "کسٹمر پورٹل"),
          L("Pivot reports & AI insights", "پوٹ رپورٹ اور AI بصیرت"),
        ],
        cta: L("Start Free Trial", "مفت ٹرائل شروع کریں"),
      },
      {
        id: "pro",
        name: L("Pro", "پرو"),
        tagline: L("Construction & procurement in the mix", "کنسٹرکشن اور پروکیورمنٹ کے ساتھ"),
        monthly: 75000,
        yearly: 750000,
        features: [
          L("Everything in Growth", "گروتھ کی سب کچھ"),
          L("Construction phases & tasks", "کنسٹرکشن مراحل اور کام"),
          L("Procurement, POs, GRN & stock", "پروکیورمنٹ، آرڈر، رسید اور اسٹاک"),
          L("Vendors, expenses & accounting", "وینڈر، اخراجات اور اکاؤنٹنگ"),
          L("E-signatures", "الیکٹرانک دستخط"),
        ],
        cta: L("Start Free Trial", "مفت ٹرائل شروع کریں"),
      },
      {
        id: "enterprise",
        name: L("Enterprise", "انٹرپرائز"),
        tagline: L("Many entities, custom controls", "متعدد اکائیاں، حسب ضرورت کنٹرول"),
        monthly: null,
        yearly: null,
        priceLabel: L("Contact us", "ہم سے رابطہ کریں"),
        features: [
          L("Everything in Pro", "پرو کی سب کچھ"),
          L("Multi-entity & consolidation", "متعدد اکائیاں اور مجموعہ"),
          L("SSO, API keys & webhooks", "SSO، API keys اور webhooks"),
          L("Priority onboarding & support", "ترجیحی شروعات اور سپورٹ"),
        ],
        cta: L("Book a Demo", "ڈیمو بک کریں"),
      },
    ],
  },

  testimonials: {
    // Hidden until real, permissioned quotes exist. Never show fabricated reviews.
    show: false,
    eyebrow: L("Customer stories", "گاہک کی کہانیاں"),
    title: L("What teams say", "ٹیم کیا کہتی ہے"),
    placeholder: L(
      "Add your first customer story in content.ts — this section is hidden until then.",
      "اپنی پہلی کسٹمر کہانی content.ts میں شامل کریں — اس سے پہلے یہ سیکشن پوشیدہ ہے۔",
    ),
    items: [],
  },

  faq: {
    eyebrow: L("FAQ", "عام سوالات"),
    title: L("Questions, answered", "سوالات، جوابات"),
    items: [
      {
        q: L("Is my data secure?", "کیا میرا ڈیٹا محفوظ ہے؟"),
        a: L(
          "Yes. Each company is an isolated tenant, access is role-based, sensitive document fields are encrypted at rest and masked by default, and every reveal or download is audit-logged.",
          "جی ہاں۔ ہر کمپنی الگ ٹیننٹ ہے، رسائی رول پر مبنی، حساس دستاویزی فیلڈز خفیہ اور ڈیفالٹ میں چھپے، اور ہر ظاہر/ڈاؤن لوڈ آڈٹ لاگ ہوتا ہے۔",
        ),
      },
      {
        q: L("How are tenants kept separate?", "ٹیننٹ الگ کیسے رکھے جاتے ہیں؟"),
        a: L(
          "Every record carries a tenant id and every query is scoped to the signed-in tenant, so one company's data is never visible to another. Isolation is tested at the API layer.",
          "ہر ریکارڈ پر ٹیننٹ id ہوتی ہے اور ہر سوال سائن اِن شدہ ٹیننٹ تک محدود، تو ایک کمپنی کا ڈیٹا دوسرے کو نظر نہیں آتا۔ الگ تھلگ ہونا API سطح پر ٹیسٹ شدہ۔",
        ),
      },
      {
        q: L("Is Urdu supported?", "کیا اردو سپورٹ ہے؟"),
        a: L(
          "The marketing site is fully bilingual with a right-to-left Urdu layout. The workspace supports English and Urdu content fields and bilingual message templates for reminders.",
          "مارکیٹنگ سائٹ مکمل دوزبانہ اور اردو RTL لے آؤٹ کے ساتھ۔ ورک اسپیس میں اردو مواد اور دوزبانہ پیغامات کے ٹیمپلیٹس۔",
        ),
      },
      {
        q: L("Can I import my Excel data?", "کیا میں اپنا Excel ڈیٹا امپورٹ کر سکتا ہوں؟"),
        a: L(
          "Yes — projects and unit inventory support bulk import, so you can move existing registers into DeedOrbit instead of retyping them.",
          "جی ہاں — پروجیکٹ اور یونٹ انوینٹری بلک امپورٹ سپورٹ کرتے ہیں، تو موجودہ رجسٹر منتقل کریں، دوبارہ لکھیں نہیں۔",
        ),
      },
      {
        q: L("Who owns the data?", "ڈیٹا کا مالک کون؟"),
        a: L(
          "You do. Your tenant's data is yours; you can export it and, on request, have it removed. DeedOrbit processes it only to run the service for you.",
          "آپ کا۔ آپ کے ٹیننٹ کا ڈیٹا آپ کا ہے؛ آپ اسے ایکسپورٹ اور درخواست پر حذف کروا سکتے ہیں۔ DeedOrbit صرف خدمت چلانے کے لیے پروسیس کرتا ہے۔",
        ),
      },
      {
        q: L("Do you take backups?", "کیا آپ بیک اپ لیتے ہیں؟"),
        a: L(
          "The database is designed for scheduled backups and point-in-time recovery depending on your hosting plan. Enterprise includes managed backup and retention terms.",
          "ڈیٹابیس شیڈولڈ بیک اپ اور ریکوری کے لیے بنایا گیا، آپ کی ہوسٹنگ پلان پر منحصر۔ انٹرپرائز میں مینجڈ بیک اپ اور ریٹینشن شامل۔",
        ),
      },
      {
        q: L("Do reminders really go out on WhatsApp?", "کیا یاد دہانیاں واقعی واٹس ایپ جاتی ہیں؟"),
        a: L(
          "DeedOrbit generates and queues reminders across SMS, WhatsApp and email templates. Live delivery connects through your own messaging provider keys.",
          "DeedOrbit یاد دہانیاں SMS، واٹس ایپ اور ای میل ٹیمپلیٹس میں بناتا ہے۔ اصل ترسیل آپ کے اپنے میسجنگ پرووائیڈر keys سے جڑتی ہے۔",
        ),
      },
      {
        q: L("What does the free trial include?", "مفت ٹرائل میں کیا شامل ہے؟"),
        a: L(
          "A new workspace with you as owner and the full feature set to explore for 14 days. No card is required to start. (The trial length is a commercial policy — confirm it is enforced for your hosting before promising it.)",
          "نیا ورک اسپیس، آپ بطور مالک، اور 14 دن مکمل خصوصیات۔ شروع میں کارڈ ضروری نہیں۔ (ٹرائل مدت ایک تجارتی پالیسی ہے — وعدے سے پہلے تصدیق کریں کہ آپ کی ہوسٹنگ پر لاگو ہے۔)",
        ),
      },
    ],
  },

  ctaBand: {
    title: L("Ready to bring order to your real estate business?", "اپنے ریئل اسٹیٹ کاروبار میں نظم لانے کے لیے تیار ہیں؟"),
    body: L(
      "Start a workspace in minutes, or let us walk your team through it.",
      "منٹوں میں ورک اسپیس شروع کریں، یا ہم آپ کی ٹیم کو سمجھا دیں۔",
    ),
    primary: L("Start Free Trial", "مفت ٹرائل شروع کریں"),
    secondary: L("Book a Demo", "ڈیمو بک کریں"),
  },

  footer: {
    productTitle: L("Product", "پروڈکٹ"),
    companyTitle: L("Company", "کمپنی"),
    legalTitle: L("Legal", "قانونی"),
    productLinks: [
      L("Features", "خصوصیات"),
      L("How it works", "کیسے کام کرتا ہے"),
      L("Pricing", "قیمت"),
      L("Sign in", "سائن اِن"),
    ],
    companyLinks: [
      L("Book a demo", "ڈیمو بک کریں"),
      L("Contact", "رابطہ"),
    ],
    legal: {
      privacy: L("Privacy Policy", "پرائیویسی پالیسی"),
      terms: L("Terms of Service", "سروس کی شرائط"),
    },
    madeIn: L("Made in Pakistan", "پاکستان میں بنایا گیا"),
  },

  demo: {
    eyebrow: L("Book a demo", "ڈیمو بک کریں"),
    title: L("See DeedOrbit on your own numbers", "اپنے اعداد پر DeedOrbit دیکھیں"),
    body: L(
      "Tell us a little about your business and we'll set up a walkthrough.",
      "اپنے کاروبار کے بارے میں بتائیں، ہم ایک واک تھو سیٹ اپ کریں گے۔",
    ),
    fields: {
      name: L("Your name", "آپ کا نام"),
      company: L("Company", "کمپنی"),
      email: L("Work email", "ورک ای میل"),
      phone: L("Phone", "فون"),
      projects: L("Number of projects", "پروجیکٹس کی تعداد"),
    },
    submit: L("Request demo", "ڈیمو کی درخواست"),
    sending: L("Sending…", "بھیجی جا رہی ہے…"),
    success: L(
      "Thanks — your demo request has been recorded and our team will reach out.",
      "شکریہ — آپ کی درخواست درج ہو گئی ہے، ہماری ٹیم رابطہ کرے گی۔",
    ),
    error: L("Something went wrong. Please try again.", "کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔"),
  },

  auth: {
    backHome: L("Back to home", "ہوم پر واپس"),
    // Marketing-side copy shown next to the reused sign-in / sign-up forms.
    asideTitle: L(
      "One workspace for the full sales and finance lifecycle.",
      "مکمل سیلز اور فنانس lifecycle کے لیے ایک ورک اسپیس۔",
    ),
    asideBody: L(
      "Inventory, bookings, installments, documents and recovery — on a single, audited, tenant-isolated ledger.",
      "انوینٹری، بکنگ، اقساط، دستاویزات اور وصولی — ایک ہی، آڈٹ شدہ، الگ لیجر پر۔",
    ),
    trialBadge: L("14-day free trial · no card required", "14 دن مفت ٹرائل · کارڈ ضروری نہیں"),
    agreePrefix: L("I agree to the", "میں متفق ہوں"),
    agreeTerms: L("Terms", "شرائط"),
    agreeAnd: L("and", "اور"),
    agreePrivacy: L("Privacy Policy", "پرائیویسی پالیسی"),
    agreeError: L("Please accept the Terms and Privacy Policy.", "براہ کرم شرائط اور پرائیویسی قبول کریں۔"),
  },

  cookie: {
    body: L(
      "We use only essential cookies to keep you signed in. No advertising or tracking cookies are set.",
      "ہم صرف ضروری کوکی استعمال کرتے ہیں تاکہ آپ سائن اِن رہیں۔ اشتہاری یا ٹریکنگ کوکی نہیں۔",
    ),
    accept: L("Got it", "ٹھیک ہے"),
  },

  legal: {
    draftBanner: L(
      "Draft text — review with a lawyer before publishing.",
      "مسودہ — شائع سے پہلے وکیل سے جائزہ لیں۔",
    ),
    updated: L("Last updated", "آخری اپ ڈیٹ"),
    privacyTitle: L("Privacy Policy", "پرائیویسی پالیسی"),
    termsTitle: L("Terms of Service", "سروس کی شرائط"),
  },
} as const

export type MarketingContent = typeof content
