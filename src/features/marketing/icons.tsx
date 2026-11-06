import {
  AlertTriangle,
  BellRing,
  Building2,
  CalendarClock,
  CircleDollarSign,
  FileSignature,
  FolderSearch,
  HardHat,
  Languages,
  Layers,
  MapPin,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  FileWarning,
  type LucideIcon,
} from "lucide-react"

/**
 * Maps the icon *names* stored in `content.ts` to Lucide components, so the copy
 * file stays import-free and safe to edit. An unknown name falls back to the
 * building glyph rather than rendering nothing.
 */
const ICONS: Record<string, LucideIcon> = {
  ShieldCheck,
  Languages,
  CalendarClock,
  Building2,
  MapPin,
  Users,
  UserPlus,
  HardHat,
  Layers,
  Sparkles,
  BellRing,
  FileSignature,
  CircleDollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  FileWarning,
  FolderSearch,
}

interface LandingIconProps {
  name: string
  size?: number
  strokeWidth?: number
  className?: string
}

export function LandingIcon({
  name,
  size = 20,
  strokeWidth = 1.75,
  className,
}: LandingIconProps) {
  const Icon = ICONS[name] ?? Building2
  return <Icon size={size} strokeWidth={strokeWidth} className={className} />
}
