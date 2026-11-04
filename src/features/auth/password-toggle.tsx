import { Eye, EyeOff } from "lucide-react"

/**
 * Show/hide control for password inputs. Lives inside the input's relative
 * wrapper, so the Field's label and error wiring is unaffected.
 */
export function PasswordToggle({
  visible,
  onToggle,
}: {
  visible: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      <span className="sr-only">
        {visible ? "Hide password" : "Show password"}
      </span>
    </button>
  )
}
