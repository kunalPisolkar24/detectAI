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

export interface Review {
  name: string;
  username: string;
  body: string;
}

export const REVIEWS_DATA: Review[] = [
  {
    name: "Aarav Mehta",
    username: "@aaravm",
    body: "I pasted a draft I wrote myself and DetectAI confirmed it was human. The verdict came back in seconds.",
  },
  {
    name: "Priya Nair",
    username: "@priyanair",
    body: "We use it to screen submissions before review. It flags the ones that need a closer look without slowing us down.",
  },
  {
    name: "Rohan Das",
    username: "@rohandas",
    body: "The breakdown makes it easy to see which sentences feel machine-written. Far more useful than a simple score.",
  },
  {
    name: "Sneha Iyer",
    username: "@snehaiyer",
    body: "Two models and a clear result — exactly what I needed for checking client copy before it goes out.",
  },
  {
    name: "Kabir Shah",
    username: "@kabirshah",
    body: "I uploaded a long report and got a verdict without any fuss. It has become part of my editing routine.",
  },
  {
    name: "Meera Rao",
    username: "@meerarao",
    body: "I was skeptical, but it caught AI-written passages I had missed. The confidence score matches my gut.",
  },
];
