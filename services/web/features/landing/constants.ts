import { type IconSvgElement } from "@hugeicons/react";
import {
  Github01Icon,
  Linkedin01Icon,
  Mail01Icon,
  NewTwitterEllipseIcon,
} from "@hugeicons/core-free-icons";
import {
  BookOpen,
  CircleHelp,
  CreditCard,
  Flame,
  Gauge,
  Highlighter,
  LifeBuoy,
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
  { href: "/contact", label: "Contact", icon: Mail },
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

export const CONTACT_EMAIL = "info@detectai.com";

export interface ContactChannel {
  id: string;
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  subject?: string;
  cta: string;
}

export const CONTACT_TEXT = {
  badge: "Contact",
  title: "Talk to a human.",
  description:
    "No bots, no ticket black holes. Write to us directly and a real person from the Detect AI team will get back to you.",
  channelsTitle: "Reach out directly",
  ctaTitle: "Prefer to browse first?",
  ctaDescription:
    "Most questions about accuracy, plans, and privacy already have answers.",
  ctaLabel: "Visit support",
} as const;

export const CONTACT_CHANNELS: ContactChannel[] = [
  {
    id: "general",
    icon: Mail,
    title: "General contact",
    tagline: "Say hello",
    description: "Questions, feedback, partnerships, or just saying hello.",
    cta: "Email us",
  },
  {
    id: "support",
    icon: LifeBuoy,
    title: "Support",
    tagline: "We're here to help",
    description: "Trouble signing in, billing questions, or results that look off.",
    subject: "Support request",
    cta: "Get support",
  },
];

export const SUPPORT_TEXT = {
  badge: "Support",
  title: "How can we help?",
  description:
    "Pick a topic below to email us with the right context attached. Every message is read by a real person on the Detect AI team.",
  topicsTitle: "What do you need help with?",
  checklistTitle: "Before you write in",
  ctaLabel: "Email support",
} as const;

export interface SupportTopic {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  subject: string;
}

export const SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: "getting-started",
    icon: BookOpen,
    title: "Getting started",
    description: "Accounts, signing in, running your first detection, and understanding results.",
    subject: "Getting started question",
  },
  {
    id: "billing",
    icon: CreditCard,
    title: "Billing & Premium",
    description: "Plans, upgrades, cancellations, and anything about Flare access.",
    subject: "Billing question",
  },
  {
    id: "results",
    icon: Gauge,
    title: "Detection questions",
    description: "A result looks off, scores are confusing, or highlights seem wrong.",
    subject: "Question about my results",
  },
];

export const SUPPORT_CHECKLIST = [
  "The email address on your account",
  "Your plan (Spark or Flare) and the model you used",
  "What you expected vs. what you saw",
  "Never include passwords — we will never ask for them",
] as const;

export type LegalBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export const TERMS_TEXT = {
  badge: "Legal",
  title: "Terms of Service",
  description:
    "The ground rules for using Detect AI — what you can expect from us, and what we expect from you.",
  updated: "September 2026",
  tocTitle: "On this page",
  contactTitle: "Questions about these terms?",
  contactDescription: "Write to us and we'll clarify anything in this document.",
  contactSubject: "Question about the Terms of Service",
  contactCta: "Contact us",
} as const;

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "acceptance",
    title: "Acceptance of these terms",
    blocks: [
      {
        type: "paragraph",
        text: "These Terms of Service (the “Terms”) govern your access to and use of Detect AI, including our website, detection models, and related features (the “Service”). By creating an account or using the Service, you agree to these Terms.",
      },
      {
        type: "paragraph",
        text: "If you do not agree, please do not use the Service. We may update these Terms from time to time; continued use after changes take effect constitutes acceptance of the revised Terms.",
      },
    ],
  },
  {
    id: "accounts",
    title: "Accounts and eligibility",
    blocks: [
      {
        type: "paragraph",
        text: "You may analyze text without an account within the limits of our free offering. Creating an account unlocks chat history, higher limits, and Premium features.",
      },
      {
        type: "list",
        items: [
          "You must provide accurate registration information and keep your credentials confidential.",
          "You are responsible for all activity under your account.",
          "You must be at least 13 years old (or the minimum age in your jurisdiction) to use the Service.",
        ],
      },
    ],
  },
  {
    id: "plans",
    title: "Plans and billing",
    blocks: [
      {
        type: "paragraph",
        text: "Spark is our free tier and includes standard AI detection within daily usage limits. Flare is our paid tier with deeper analysis and unlimited scans, billed monthly or yearly.",
      },
      {
        type: "list",
        items: [
          "Paid subscriptions are processed securely by our payment provider; we never see or store your full card details.",
          "You may cancel at any time from your Profile page. Access continues until the end of the current billing period, after which your account reverts to the free tier.",
          "Refunds are handled case by case — contact us if you believe you were charged in error.",
        ],
      },
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    blocks: [
      {
        type: "paragraph",
        text: "You agree not to misuse the Service. In particular, you must not:",
      },
      {
        type: "list",
        items: [
          "Submit content you have no right to analyze, or that is unlawful, hateful, or infringes anyone's rights.",
          "Upload files other than supported documents (.pdf, .docx, .txt, up to 10 MB) or attempt to circumvent file and length limits.",
          "Abuse, disrupt, or reverse-engineer the Service, or attempt to extract our models, circumvent rate limits, or access other users' data.",
        ],
      },
      {
        type: "paragraph",
        text: "We may suspend or terminate accounts that violate these rules.",
      },
    ],
  },
  {
    id: "ai-results",
    title: "AI-generated results",
    blocks: [
      {
        type: "paragraph",
        text: "Detection scores, labels, and highlighted passages are probabilistic estimates produced by machine-learning models — not guarantees. AI can make mistakes.",
      },
      {
        type: "paragraph",
        text: "Do not rely solely on our results for high-stakes decisions (academic discipline, employment, legal, or medical matters). Always verify important outcomes through independent review.",
      },
    ],
  },
  {
    id: "ip",
    title: "Intellectual property",
    blocks: [
      {
        type: "paragraph",
        text: "The Service, including our models, software, branding, and site content, is owned by Detect AI and protected by intellectual-property laws. These Terms grant you a limited, non-exclusive, non-transferable license to use the Service for its intended purpose.",
      },
      {
        type: "paragraph",
        text: "You retain all rights to text you submit. By submitting text, you grant us only the narrow license needed to analyze it and return results to you.",
      },
    ],
  },
  {
    id: "termination",
    title: "Suspension and termination",
    blocks: [
      {
        type: "paragraph",
        text: "You may stop using the Service and delete your account at any time. We may suspend or terminate access for violations of these Terms, abuse, non-payment, or to comply with legal obligations.",
      },
      {
        type: "paragraph",
        text: "Sections that by their nature should survive (intellectual property, disclaimers, liability limits) survive termination.",
      },
    ],
  },
  {
    id: "liability",
    title: "Disclaimers and liability",
    blocks: [
      {
        type: "paragraph",
        text: "The Service is provided “as is” without warranties of any kind, including accuracy, reliability, or fitness for a particular purpose, to the maximum extent permitted by law.",
      },
      {
        type: "paragraph",
        text: "To the maximum extent permitted by law, Detect AI's total liability is limited to the amounts you paid in the 12 months preceding the claim (or $0 for free-tier users). These Terms are governed by the laws of [Jurisdiction].",
      },
    ],
  },
  {
    id: "changes-contact",
    title: "Changes and contact",
    blocks: [
      {
        type: "paragraph",
        text: "We may revise these Terms as the Service evolves. Material changes will be reflected in the “Last updated” date above, and continued use constitutes acceptance.",
      },
      {
        type: "paragraph",
        text: "Questions about these Terms? Contact us.",
      },
    ],
  },
];

export const PRIVACY_TEXT = {
  badge: "Legal",
  title: "Privacy Policy",
  description:
    "What we collect, what we never keep, and the choices you have over your information.",
  updated: "September 2026",
  tocTitle: "On this page",
  contactTitle: "Questions about your privacy?",
  contactDescription:
    "Write to us about your data, your rights, or anything in this policy.",
  contactSubject: "Privacy question",
  contactCta: "Contact us",
} as const;

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "overview",
    title: "Overview",
    blocks: [
      {
        type: "paragraph",
        text: "This Privacy Policy explains what information Detect AI collects, how we use it, and the choices you have. Our core principle is simple: we collect the minimum needed to run the Service, and your submitted text is never stored or shared.",
      },
    ],
  },
  {
    id: "data-collected",
    title: "Information we collect",
    blocks: [
      {
        type: "list",
        items: [
          "Account information — email address and profile details you provide when registering or updating your profile.",
          "Billing information — processed securely by our payment provider (Paddle). We receive subscription status, never your full card details.",
          "Verification signals — our captcha provider (Cloudflare Turnstile) confirms you are human during sign-in and sign-up.",
          "OAuth basics — if you sign in with Google or GitHub, we receive the basic profile they share (such as name and email).",
          "Usage and diagnostics — aggregated, non-identifying metrics (such as scan counts and error rates) used to keep the Service reliable.",
        ],
      },
    ],
  },
  {
    id: "submitted-text",
    title: "Text you submit for analysis",
    blocks: [
      {
        type: "paragraph",
        text: "Text and documents you submit are analyzed in memory to produce your result and are never stored, logged, or shared. Once your analysis completes, the submitted content is discarded.",
      },
      {
        type: "paragraph",
        text: "Only the metadata needed for your account — such as your scan counts and subscription status — is retained.",
      },
    ],
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    blocks: [
      {
        type: "list",
        items: [
          "Session cookies — keep you signed in and remember security preferences.",
          "Local preferences — interface choices (such as theme and selected model) are stored in your own browser and never leave your device.",
        ],
      },
      {
        type: "paragraph",
        text: "You can clear cookies and site data in your browser at any time; doing so will sign you out and reset local preferences.",
      },
    ],
  },
  {
    id: "third-parties",
    title: "Third-party services",
    blocks: [
      {
        type: "paragraph",
        text: "We share the minimum necessary data with the providers who power the Service:",
      },
      {
        type: "list",
        items: [
          "Paddle — subscription billing and checkout.",
          "Cloudflare Turnstile — bot protection on auth forms.",
          "Google / GitHub — only if you choose OAuth sign-in.",
        ],
      },
      {
        type: "paragraph",
        text: "Each provider processes data under its own privacy policy. We do not sell personal information to anyone, for any reason.",
      },
    ],
  },
  {
    id: "retention",
    title: "Data retention",
    blocks: [
      {
        type: "paragraph",
        text: "Account and billing records are kept while your account is active and as required for legal, tax, and accounting purposes. If you delete your account, we remove your profile data and revoke access; anonymized, aggregated metrics that cannot identify you may be retained for reliability monitoring.",
      },
    ],
  },
  {
    id: "rights",
    title: "Your rights",
    blocks: [
      {
        type: "paragraph",
        text: "Depending on where you live, you may have the right to access, correct, export, or delete your personal information, and to object to or restrict certain processing.",
      },
      {
        type: "paragraph",
        text: "To exercise any of these rights, write to us at the address below. We respond to all verified requests as required by applicable law.",
      },
    ],
  },
  {
    id: "changes-contact",
    title: "Changes and contact",
    blocks: [
      {
        type: "paragraph",
        text: "We may update this policy as the Service evolves. Material changes will be reflected in the “Last updated” date above.",
      },
      {
        type: "paragraph",
        text: "Privacy questions or requests? Contact us.",
      },
    ],
  },
];
