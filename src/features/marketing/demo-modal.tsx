import { useEffect, useRef, useState, type Ref } from "react"
import { Check, X } from "lucide-react"
import { content } from "@/features/marketing/content"
import { useMarketingLang } from "@/features/marketing/i18n"
import { MarketingButton } from "@/features/marketing/button"
import { api } from "@/lib/api"

interface DemoModalProps {
  open: boolean
  onClose: () => void
}

interface DemoForm {
  name: string
  company: string
  email: string
  phone: string
  projects: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const EMPTY: DemoForm = { name: "", company: "", email: "", phone: "", projects: "" }

type Status = "idle" | "sending" | "success" | "error"

export function DemoModal({ open, onClose }: DemoModalProps) {
  const { t } = useMarketingLang()
  const d = content.demo
  const [form, setForm] = useState<DemoForm>(EMPTY)
  const [status, setStatus] = useState<Status>("idle")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    firstFieldRef.current?.focus()
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const update = (key: keyof DemoForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (status === "error") setStatus("idle")
  }

  const submit = async () => {
    setFieldError(null)
    if (!form.name.trim() || !form.company.trim()) {
      setFieldError(t(d.fields.name))
      return
    }
    if (!EMAIL_PATTERN.test(form.email)) {
      setFieldError(t(d.fields.email))
      return
    }
    setStatus("sending")
    try {
      await api.post("/api/demo-requests", {
        name: form.name.trim(),
        company: form.company.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        projects: form.projects.trim(),
      })
      setStatus("success")
    } catch {
      setStatus("error")
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(d.title)}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-6 shadow-overlay sm:rounded-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute end-4 top-4 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <X size={18} />
        </button>

        {status === "success" ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check size={26} strokeWidth={2.5} />
            </div>
            <h2 className="font-display mt-4 text-xl font-semibold text-foreground">
              {t(d.title)}
            </h2>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
              {t(d.success)}
            </p>
            <MarketingButton className="mt-6 w-full" onClick={onClose}>
              {t(content.cookie.accept)}
            </MarketingButton>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
              {t(d.eyebrow)}
            </p>
            <h2 className="font-display mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {t(d.title)}
            </h2>
            <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
              {t(d.body)}
            </p>

            <div className="mt-5 space-y-3.5">
              <Field
                inputRef={firstFieldRef}
                label={t(d.fields.name)}
                value={form.name}
                onChange={(v) => update("name", v)}
              />
              <Field
                label={t(d.fields.company)}
                value={form.company}
                onChange={(v) => update("company", v)}
              />
              <Field
                label={t(d.fields.email)}
                type="email"
                value={form.email}
                onChange={(v) => update("email", v)}
              />
              <Field
                label={t(d.fields.phone)}
                type="tel"
                value={form.phone}
                onChange={(v) => update("phone", v)}
              />
              <Field
                label={t(d.fields.projects)}
                type="number"
                value={form.projects}
                onChange={(v) => update("projects", v)}
              />
            </div>

            {status === "error" || fieldError ? (
              <p className="mt-3 text-[13px] text-danger" role="alert">
                {status === "error"
                  ? t(d.error)
                  : `${t(d.fields.company)}: ${fieldError}`}
              </p>
            ) : null}

            <MarketingButton
              className="mt-5 w-full"
              size="lg"
              disabled={status === "sending"}
              onClick={submit}
            >
              {status === "sending" ? t(d.sending) : t(d.submit)}
            </MarketingButton>
          </>
        )}
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  inputRef?: Ref<HTMLInputElement>
}

function Field({ label, value, onChange, type = "text", inputRef }: FieldProps) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-foreground">{label}</span>
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-input bg-white px-3 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    </label>
  )
}
