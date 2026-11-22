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
  description: [
    "Provide your text, and our model will predict its classification.",
    "Fast and efficient predictions in seconds.",
  ],
  cta: "Get started!",
  ctaHref: "/signup",
} as const;

export const VISUALIZER_TEXT =
  "The report reads with the natural rhythm and imperfect cadence of a human author, yet it was written entirely by a language model. Our models weigh sentence structure, token probability, and stylistic consistency to surface the signals that matter.";

export const VISUALIZER_TEXT_COMPACT =
  "It reads human, yet a language model wrote it. Our models weigh sentence structure, token probability, and stylistic consistency to surface the signals that matter.";

export interface Review {
  name: string;
  username: string;
  body: string;
}

export const REVIEWS_DATA: Review[] = [
  {
    name: "Aarav Mehta",
    username: "@aaravm",
    body: "I pasted my own draft and DetectAI confirmed it was human in seconds.",
  },
  {
    name: "Priya Nair",
    username: "@priyanair",
    body: "We use it to screen submissions before review. It flags what needs a closer look.",
  },
  {
    name: "Rohan Das",
    username: "@rohandas",
    body: "The breakdown shows which sentences feel machine-written far more useful than a score.",
  },
  {
    name: "Sneha Iyer",
    username: "@snehaiyer",
    body: "Two models and a clear result exactly what I need before client copy goes out.",
  },
  {
    name: "Kabir Shah",
    username: "@kabirshah",
    body: "I uploaded a long report and got a verdict without fuss. It is part of my editing routine now.",
  },
  {
    name: "Meera Rao",
    username: "@meerarao",
    body: "I was skeptical, but it caught AI passages I had missed. The score matches my gut.",
  },
];

export type BillingCycle = "monthly" | "yearly";

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  price: Record<BillingCycle, string>;
  features: string[];
  featured?: boolean;
  cta: string;
}

export const PRICING_TEXT = {
  eyebrow: "Pricing",
  title: "Choose The Plan For AI Text Detection",
  description: [
    "From simple AI text detection to in-depth analysis with advanced models,",
    "choose the plan that fits your requirements.",
  ],
  note: "All plans include access to our web interface. Cancel anytime.",
  yearlySavings: "Save 58%",
} as const;

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "spark",
    name: "Spark",
    description: "Perfect for individuals getting started with AI detection.",
    price: { monthly: "₹0", yearly: "₹0" },
    features: [
      "Standard AI detection",
      "100 scans per day",
      "Basic reporting",
      "Community support",
    ],
    cta: "Get Started",
  },
  {
    id: "flare",
    name: "Flare",
    description: "Advanced power for professionals and heavy users.",
    price: { monthly: "₹200", yearly: "₹1000" },
    features: [
      "Advanced AI detection",
      "Unlimited scans",
      "Deep analysis & insights",
      "Priority support",
      "Early access to features",
    ],
    featured: true,
    cta: "Upgrade Now",
  },
];
