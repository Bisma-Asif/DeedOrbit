import { Badge } from "@/components/ui/badge"
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  type ProjectStatus,
} from "@shared/projects"

/**
 * The one place a project status is rendered.
 *
 * The tone comes from `shared/projects` rather than from the label text, so the
 * list, the detail header, and the status picker cannot disagree about what
 * "On hold" looks like. Colour here is carrying meaning — a stalled development
 * and a launched one must not look alike — which is why this is a component and
 * not an inline `<Badge>` at each call site.
 */
export function ProjectStatusBadge({
  status,
  className,
}: {
  status: ProjectStatus
  className?: string
}) {
  return (
    <Badge variant={PROJECT_STATUS_TONES[status]} className={className}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  )
}
