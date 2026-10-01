import {
  Bike,
  Briefcase,
  Building2,
  Clock,
  CloudSun,
  Footprints,
  GraduationCap,
  Hash,
  HeartPulse,
  House,
  MapPin,
  MessageCircle,
  Palette,
  PawPrint,
  Plane,
  Shirt,
  ShoppingBag,
  Smartphone,
  Smile,
  Soup,
  Stethoscope,
  Sun,
  Tag,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'

/** A picture for each theme the packs define; one added later gets the plain tag until it has its own. */
const THEME_ICON: Readonly<Record<string, LucideIcon>> = {
  people: Users,
  greetings: MessageCircle,
  food: Soup,
  restaurant: UtensilsCrossed,
  home: House,
  'daily-life': Sun,
  time: Clock,
  numbers: Hash,
  travel: Plane,
  directions: MapPin,
  shopping: ShoppingBag,
  work: Briefcase,
  school: GraduationCap,
  body: HeartPulse,
  doctor: Stethoscope,
  clothes: Shirt,
  weather: CloudSun,
  animals: PawPrint,
  colours: Palette,
  feelings: Smile,
  hobbies: Bike,
  technology: Smartphone,
  city: Building2,
  actions: Footprints,
}

/** A theme's picture, or the plain tag: on the Themes page's cards and the setup's theme rows (plan 11). */
export function ThemeIcon(props: { readonly themeId: string; readonly size: number }) {
  const Icon = THEME_ICON[props.themeId] ?? Tag
  return <Icon size={props.size} strokeWidth={1.75} />
}
