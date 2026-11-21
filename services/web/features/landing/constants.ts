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

export const HERO_TEXT = {
  badge: "Introducing Detect AI",
  titleStart: "Detect your text",
  titleEnd: "in Seconds!",
  description:
    "Provide your text, and our model will predict its classification. Fast and efficient predictions in seconds.",
  cta: "Get started!",
  ctaHref: "/signup",
} as const;

export const VISUALIZER_TEXT =
  "The report reads with the natural rhythm and imperfect cadence of a human author, yet it was written entirely by a language model. Our models weigh sentence structure, token probability, and stylistic consistency to surface the signals that matter.";

export const VISUALIZER_TEXT_COMPACT =
  "It reads human, yet a language model wrote it. Our models weigh sentence structure, token probability, and stylistic consistency to surface the signals that matter.";
