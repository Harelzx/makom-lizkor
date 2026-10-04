import {
  ArmchairIcon,
  BinocularsIcon,
  FlowerIcon,
  HomeIcon,
  LandmarkIcon,
  MapPinIcon,
  ScrollTextIcon,
  ShieldIcon,
  SparklesIcon,
  TreesIcon,
  UsersIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Kind } from "@/types"

const ICONS: Record<Kind, LucideIcon> = {
  community: UsersIcon,
  monument: LandmarkIcon,
  bench: ArmchairIcon,
  lookout: BinocularsIcon,
  grove: TreesIcon,
  garden: FlowerIcon,
  plaque: ScrollTextIcon,
  shelter: ShieldIcon,
  site: MapPinIcon,
  museum: HomeIcon,
  other: SparklesIcon,
}

export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const Icon = ICONS[kind]
  return <Icon className={className} aria-hidden="true" />
}
