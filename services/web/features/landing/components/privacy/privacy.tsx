import { ShieldUserIcon } from "@hugeicons/core-free-icons";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

import { PRIVACY_SECTIONS, PRIVACY_TEXT } from "../../constants";
import { LegalBody, LegalContact, LegalHero } from "../legal";

export function Privacy() {
  return (
    <Section className="overflow-hidden">
      <Container className="flex flex-col items-center space-y-10 sm:space-y-12">
        <LegalHero
          badge={PRIVACY_TEXT.badge}
          title={PRIVACY_TEXT.title}
          description={PRIVACY_TEXT.description}
          hugeIcon={ShieldUserIcon}
        />
        <LegalBody
          updated={PRIVACY_TEXT.updated}
          sections={PRIVACY_SECTIONS}
          tocTitle={PRIVACY_TEXT.tocTitle}
        />
        <LegalContact
          title={PRIVACY_TEXT.contactTitle}
          description={PRIVACY_TEXT.contactDescription}
          subject={PRIVACY_TEXT.contactSubject}
          ctaLabel={PRIVACY_TEXT.contactCta}
        />
      </Container>
    </Section>
  );
}
