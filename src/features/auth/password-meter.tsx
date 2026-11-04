import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { passwordRules } from "@/features/auth/password-rules"

/**
 * Four-rule checklist rather than a strength bar. A score invites arguments
 * about what "strong" means; naming the exact requirement is unambiguous and
 * matches what the server will actually accept.
 */
export function PasswordMeter({ password }: { password: string }) {
  if (password.length === 0) return null
  const rules = passwordRules(password)
  const met = rules.filter((rule) => rule.met).length

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5" aria-hidden>
        {rules.map((rule) => (
          <span
            key={rule.id}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              rule.met ? "bg-emerald-600" : "bg-border",
            )}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-1.5 text-[11.5px] leading-4",
              rule.met ? "text-emerald-700" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-3 shrink-0 items-center justify-center rounded-full border",
                rule.met
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-border",
              )}
            >
              {rule.met ? <Check size={8} strokeWidth={3} /> : null}
            </span>
            {rule.label}
          </li>
        ))}
      </ul>
      {met === rules.length ? (
        <p className="text-[11.5px] leading-4 text-emerald-700">
          Meets the policy.
        </p>
      ) : null}
    </div>
  )
}
