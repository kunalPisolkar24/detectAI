import { CircleHelp, CreditCard, Info, Sparkles, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_LINKS: NavItem[] = [
  { href: "#features", label: "Features", icon: Sparkles },
  { href: "#pricing", label: "Pricing", icon: CreditCard },
  { href: "#faq", label: "FAQ", icon: CircleHelp },
  { href: "/about", label: "About", icon: Info },
];
