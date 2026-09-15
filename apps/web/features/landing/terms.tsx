"use client"

import Link from "next/link"
import { FileText } from "lucide-react"
import { PageHero } from "./components/page-hero"
import { LegalLayout, type LegalSection } from "./components/legal-layout"

// DRAFT — requires review by qualified legal counsel before reliance.
// Speculative clauses are marked TODO(legal) inline.
const Dot = () => (
  <span aria-hidden="true" className="absolute left-0 top-[9px] h-1.5 w-1.5 rounded-full bg-blue-500" />
)

const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "acceptance",
    title: "Acceptance of these terms",
    content: (
      <>
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) govern your access to and use of Detect
          AI, including our website, detection models, and related features (the
          &ldquo;Service&rdquo;). By creating an account or using the Service, you agree to these
          Terms.
        </p>
        <p>
          If you do not agree, please do not use the Service. We may update these Terms from time
          to time; continued use after changes take effect constitutes acceptance of the revised
          Terms.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and eligibility",
    content: (
      <>
        <p>
          You may analyze text without an account within the limits of our free offering. Creating
          an account unlocks chat history, higher limits, and Premium features.
        </p>
        <ul>
          <li>
            <Dot /> You must provide accurate registration information and keep your credentials
            confidential.
          </li>
          <li>
            <Dot /> You are responsible for all activity under your account.
          </li>
          <li>
            <Dot /> You must be at least 13 years old (or the minimum age in your jurisdiction) to
            use the Service.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "plans",
    title: "Plans and billing",
    content: (
      <>
        <p>
          <strong>Spark</strong> is our free tier and includes standard AI detection within daily
          usage limits. <strong>Flare</strong> is our paid tier with deeper analysis and unlimited
          scans, billed monthly or yearly.
        </p>
        <ul>
          <li>
            <Dot /> Paid subscriptions are processed securely by our payment provider; we never see
            or store your full card details.
          </li>
          <li>
            <Dot /> You may cancel at any time from your Profile page. Access continues until the
            end of the current billing period, after which your account reverts to the free tier.
          </li>
          <li>
            {/* TODO(legal): confirm refund policy wording with counsel. */}
            <Dot /> Refunds are handled case by case — contact us if you believe you were charged
            in error.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    content: (
      <>
        <p>You agree not to misuse the Service. In particular, you must not:</p>
        <ul>
          <li>
            <Dot /> Submit content you have no right to analyze, or that is unlawful, hateful, or
            infringes anyone&apos;s rights.
          </li>
          <li>
            <Dot /> Upload files other than supported documents (.pdf, .docx, .txt, up to 10&nbsp;MB)
            or attempt to circumvent file and length limits.
          </li>
          <li>
            <Dot /> Abuse, disrupt, or reverse-engineer the Service, or attempt to extract our
            models, circumvent rate limits, or access other users&apos; data.
          </li>
        </ul>
        <p>We may suspend or terminate accounts that violate these rules.</p>
      </>
    ),
  },
  {
    id: "ai-results",
    title: "AI-generated results",
    content: (
      <>
        <p>
          Detection scores, labels, and highlighted passages are probabilistic estimates produced by
          machine-learning models — not guarantees. AI can make mistakes.
        </p>
        <p>
          Do not rely solely on our results for high-stakes decisions (academic discipline,
          employment, legal, or medical matters). Always verify important outcomes through
          independent review.
        </p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property",
    content: (
      <>
        <p>
          The Service, including our models, software, branding, and site content, is owned by
          Detect AI and protected by intellectual-property laws. These Terms grant you a limited,
          non-exclusive, non-transferable license to use the Service for its intended purpose.
        </p>
        <p>
          You retain all rights to text you submit. By submitting text, you grant us only the
          narrow license needed to analyze it and return results to you.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "Suspension and termination",
    content: (
      <>
        <p>
          You may stop using the Service and delete your account at any time. We may suspend or
          terminate access for violations of these Terms, abuse, non-payment, or to comply with
          legal obligations.
        </p>
        <p>
          Sections that by their nature should survive (intellectual property, disclaimers,
          liability limits) survive termination.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Disclaimers and liability",
    content: (
      <>
        <p>
          The Service is provided &ldquo;as is&rdquo; without warranties of any kind, including
          accuracy, reliability, or fitness for a particular purpose, to the maximum extent
          permitted by law.
        </p>
        {/* TODO(legal): confirm liability cap, governing law, and dispute venue with counsel. */}
        <p>
          To the maximum extent permitted by law, Detect AI&apos;s total liability is limited to
          the amounts you paid in the 12 months preceding the claim (or $0 for free-tier users).
          These Terms are governed by the laws of [Jurisdiction].
        </p>
      </>
    ),
  },
  {
    id: "changes-contact",
    title: "Changes and contact",
    content: (
      <>
        <p>
          We may revise these Terms as the Service evolves. Material changes will be reflected in
          the &ldquo;Last updated&rdquo; date above, and continued use constitutes acceptance.
        </p>
        <p>
          Questions about these Terms?{" "}
          <Link
            href="/contact"
            className="underline underline-offset-4 text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Contact us
          </Link>
          .
        </p>
      </>
    ),
  },
]

export const Terms = () => {
  return (
    <section className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-transparent text-foreground transition-colors duration-300 py-16 md:py-24">
      <div className="w-full container px-6 sm:px-8 lg:mx-auto flex flex-col items-center justify-center space-y-10 md:space-y-12 z-10">
        <PageHero
          badge="Legal"
          icon={FileText}
          title="Terms of Service"
          description="The ground rules for using Detect AI — what you can expect from us, and what we expect from you."
        />
        <LegalLayout
          updated="September 2026"
          sections={TERMS_SECTIONS}
          contactTitle="Questions about these terms?"
          contactDescription="Write to us and we'll clarify anything in this document."
          contactSubject="Question about the Terms of Service"
        />
      </div>
    </section>
  )
}
