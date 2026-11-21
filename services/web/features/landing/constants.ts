import { CircleHelp, CreditCard, Mail, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_LINKS: NavItem[] = [
  { href: "#pricing", label: "Pricing", icon: CreditCard },
  { href: "#faq", label: "FAQs", icon: CircleHelp },
  { href: "#contact", label: "Contact", icon: Mail },
];
