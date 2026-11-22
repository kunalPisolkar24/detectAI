import { type IconSvgElement } from "@hugeicons/react";
import {
  Github01Icon,
  Linkedin01Icon,
  Mail01Icon,
  NewTwitterEllipseIcon,
} from "@hugeicons/core-free-icons";
import {
  CircleHelp,
  CreditCard,
  Flame,
  Gauge,
  Highlighter,
  Mail,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";

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

export interface FaqItemData {
  question: string;
  answer: string;
}

export const FAQ_TEXT = {
  eyebrow: "FAQs",
  title: "Frequently Asked Questions",
  description: "Here are some of the most frequently asked questions about our product.",
  ctaTitle: "Still have questions?",
  ctaDescription:
    "If you couldn't find the answer to your question, feel free to reach out to our support team.",
  supportEmail: "info@detectai.com",
  ctaLabel: "Contact Support",
} as const;

export const FAQ_ITEMS: FaqItemData[] = [
  {
    question: "What is Detect AI?",
    answer:
      "Detect AI is a tool that helps identify whether a piece of text is AI-generated or human-written.",
  },
  {
    question: "How accurate is Detect AI?",
    answer:
      "Detect AI uses advanced transformer models like ModernBERT to ensure high accuracy in AI text detection.",
  },
  {
    question: "Is Detect AI free to use?",
    answer:
      "Yes! We offer a free plan with basic detection features, while the premium plan provides advanced analysis.",
  },
  {
    question: "Can Detect AI detect mixed AI and human-written content?",
    answer: "Yes, it can analyze hybrid content and highlight AI-generated sections.",
  },
  {
    question: "Do I need an account to use Detect AI?",
    answer:
      "No, you can use the free version without an account. However, creating an account unlocks additional features.",
  },
  {
    question: "How does Detect AI handle user data?",
    answer: "We prioritize privacy and do not store or share any text submitted for analysis.",
  },
];

export const FOOTER_TEXT = {
  description:
    "Detect AI helps you identify whether text is AI-generated or human-written with advanced machine learning models and high accuracy.",
  copyright: "Detect AI Inc. All rights reserved.",
} as const;

export interface FooterLink {
  name: string;
  href: string;
}

export interface FooterLinkGroup {
  title: string;
  links: FooterLink[];
}

export const FOOTER_LINK_GROUPS: FooterLinkGroup[] = [
  {
    title: "Product",
    links: [
      { name: "Pricing", href: "#pricing" },
      { name: "FAQs", href: "#faq" },
    ],
  },
  {
    title: "Company",
    links: [
      { name: "About", href: "/about" },
      { name: "Contact", href: "/contact" },
      { name: "Support", href: "/support" },
    ],
  },
  {
    title: "Legal",
    links: [
      { name: "Terms of Service", href: "/terms" },
      { name: "Privacy Policy", href: "/privacy" },
    ],
  },
];

export interface FooterSocial {
  name: string;
  href: string;
  icon: IconSvgElement;
}

export const FOOTER_SOCIALS: FooterSocial[] = [
  { name: "GitHub", href: "https://github.com", icon: Github01Icon },
  { name: "Twitter", href: "https://twitter.com", icon: NewTwitterEllipseIcon },
  { name: "LinkedIn", href: "https://linkedin.com", icon: Linkedin01Icon },
  { name: "Email", href: "mailto:info@detectai.com", icon: Mail01Icon },
];

export const ABOUT_TEXT = {
  badge: "About Detect AI",
  title: "Know the difference — Trust the evidence.",
  description:
    "Detect AI analyzes writing patterns, structure, and linguistic signals to tell AI-generated text apart from human writing — in seconds.",
  storyTitle: "Why Detect AI exists?",
  story: [
    "AI-generated text is everywhere — in classrooms, newsrooms, hiring pipelines, and publishing queues. Knowing what you're reading matters, but spotting machine writing by eye is getting harder every month.",
    "Detect AI exists to give that clarity back. Paste any text and our models break it down chunk by chunk, highlight the passages that read as artificial, and score the result — so you can judge with evidence instead of gut feel.",
  ],
  modelsTitle: "Two models, one job",
  capabilitiesTitle: "Built for evidence, not vibes",
  ctaTitle: "Ready to check your text?",
  ctaDescription: "Create a free account and run your first detection in seconds.",
  ctaLabel: "Get started",
} as const;

export interface AboutCardData {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  iconTone?: "brand" | "purple";
  iconBorder?: boolean;
  featured?: boolean;
  cta?: { label: string; href: string };
}

export const ABOUT_MODELS: AboutCardData[] = [
  {
    id: "spark",
    name: "Spark",
    tagline: "Fast everyday checks",
    description: "Quick, reliable detection for everyday content — free with 100 scans a day.",
    icon: Zap,
    iconBorder: true,
    cta: { label: "Get Spark free", href: "/signup" },
  },
  {
    id: "flare",
    name: "Flare",
    tagline: "Deep multi-layer detection",
    description: "Advanced analysis with unlimited scans for professionals and heavy users.",
    icon: Flame,
    iconTone: "purple",
    iconBorder: true,
    cta: { label: "Go Flare", href: "/signup" },
    featured: true,
  },
];

export const ABOUT_CAPABILITIES: AboutCardData[] = [
  {
    id: "highlights",
    name: "Chunk-level highlights",
    tagline: "See the evidence",
    description:
      "See exactly which passages read as AI-generated, backed by per-span confidence.",
    icon: Highlighter,
    iconBorder: true,
  },
  {
    id: "scores",
    name: "AI vs human scores",
    tagline: "Clear verdicts",
    description: "A clear verdict with calibrated confidence — not just a black-box label.",
    icon: Gauge,
    iconBorder: true,
  },
  {
    id: "privacy",
    name: "Privacy-first",
    tagline: "Your words stay yours",
    description: "Submitted text is never stored or shared. Your words stay yours.",
    icon: ShieldCheck,
    iconBorder: true,
  },
];
