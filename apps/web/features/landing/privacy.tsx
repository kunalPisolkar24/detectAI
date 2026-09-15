"use client"

import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { PageHero } from "./components/page-hero"
import { LegalLayout, type LegalSection } from "./components/legal-layout"

// DRAFT — requires review by qualified legal counsel before reliance.
// Speculative clauses are marked TODO(legal) inline.
const Dot = () => (
  <span aria-hidden="true" className="absolute left-0 top-[9px] h-1.5 w-1.5 rounded-full bg-blue-500" />
)

const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "overview",
    title: "Overview",
    content: (
      <>
        <p>
          This Privacy Policy explains what information Detect AI collects, how we use it, and the
          choices you have. Our core principle is simple: we collect the minimum needed to run the
          Service, and your submitted text is never stored or shared.
        </p>
      </>
    ),
  },
  {
    id: "data-collected",
    title: "Information we collect",
    content: (
      <>
        <ul>
          <li>
            <Dot /> <strong>Account information</strong> — email address and profile details you
            provide when registering or updating your profile.
          </li>
          <li>
            <Dot /> <strong>Billing information</strong> — processed securely by our payment
            provider (Paddle). We receive subscription status, never your full card details.
          </li>
          <li>
            <Dot /> <strong>Verification signals</strong> — our captcha provider (Cloudflare
            Turnstile) confirms you are human during sign-in and sign-up.
          </li>
          <li>
            <Dot /> <strong>OAuth basics</strong> — if you sign in with Google or GitHub, we receive
            the basic profile they share (such as name and email).
          </li>
          <li>
            <Dot /> <strong>Usage and diagnostics</strong> — aggregated, non-identifying metrics
            (such as scan counts and error rates) used to keep the Service reliable.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "submitted-text",
    title: "Text you submit for analysis",
    content: (
      <>
        <p>
          Text and documents you submit are analyzed in memory to produce your result and are{" "}
          <strong>never stored, logged, or shared</strong>. Once your analysis completes, the
          submitted content is discarded.
        </p>
        <p>
          Only the metadata needed for your account — such as your scan counts and subscription
          status — is retained.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    content: (
      <>
        <ul>
          <li>
            <Dot /> <strong>Session cookies</strong> — keep you signed in and remember security
            preferences.
          </li>
          <li>
            <Dot /> <strong>Local preferences</strong> — interface choices (such as theme and
            selected model) are stored in your own browser and never leave your device.
          </li>
        </ul>
        <p>
          You can clear cookies and site data in your browser at any time; doing so will sign you
          out and reset local preferences.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    content: (
      <>
        <p>We share the minimum necessary data with the providers who power the Service:</p>
        <ul>
          <li>
            <Dot /> <strong>Paddle</strong> — subscription billing and checkout.
          </li>
          <li>
            <Dot /> <strong>Cloudflare Turnstile</strong> — bot protection on auth forms.
          </li>
          <li>
            <Dot /> <strong>Google / GitHub</strong> — only if you choose OAuth sign-in.
          </li>
        </ul>
        <p>
          Each provider processes data under its own privacy policy. We do not sell personal
          information to anyone, for any reason.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "Data retention",
    content: (
      <>
        <p>
          Account and billing records are kept while your account is active and as required for
          legal, tax, and accounting purposes. If you delete your account, we remove your profile
          data and revoke access; anonymized, aggregated metrics that cannot identify you may be
          retained for reliability monitoring.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    content: (
      <>
        {/* TODO(legal): confirm rights procedure and response timelines (e.g. GDPR/CCPA) with counsel. */}
        <p>
          Depending on where you live, you may have the right to access, correct, export, or delete
          your personal information, and to object to or restrict certain processing.
        </p>
        <p>
          To exercise any of these rights, write to us at the address below. We respond to all
          verified requests as required by applicable law.
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
          We may update this policy as the Service evolves. Material changes will be reflected in
          the &ldquo;Last updated&rdquo; date above.
        </p>
        <p>
          Privacy questions or requests?{" "}
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

export const Privacy = () => {
  return (
    <section className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-transparent text-foreground transition-colors duration-300 py-16 md:py-24">
      <div className="w-full container px-6 sm:px-8 lg:mx-auto flex flex-col items-center justify-center space-y-10 md:space-y-12 z-10">
        <PageHero
          badge="Legal"
          icon={ShieldCheck}
          title="Privacy Policy"
          description="What we collect, what we never keep, and the choices you have over your information."
        />
        <LegalLayout
          updated="September 2026"
          sections={PRIVACY_SECTIONS}
          contactTitle="Questions about your privacy?"
          contactDescription="Write to us about your data, your rights, or anything in this policy."
          contactSubject="Privacy question"
        />
      </div>
    </section>
  )
}
