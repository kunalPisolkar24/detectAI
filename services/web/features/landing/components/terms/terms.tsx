import { Agreement03Icon } from "@hugeicons/core-free-icons";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

import { TERMS_SECTIONS, TERMS_TEXT } from "../../constants";
import { LegalBody, LegalContact, LegalHero } from "../legal";

export function Terms() {
  return (
    <Section className="overflow-hidden">
      <Container className="flex flex-col items-center space-y-10 sm:space-y-12">
        <LegalHero
          badge={TERMS_TEXT.badge}
          title={TERMS_TEXT.title}
          description={TERMS_TEXT.description}
          hugeIcon={Agreement03Icon}
        />
        <LegalBody
          updated={TERMS_TEXT.updated}
          sections={TERMS_SECTIONS}
          tocTitle={TERMS_TEXT.tocTitle}
        />
        <LegalContact
          title={TERMS_TEXT.contactTitle}
          description={TERMS_TEXT.contactDescription}
          subject={TERMS_TEXT.contactSubject}
          ctaLabel={TERMS_TEXT.contactCta}
        />
      </Container>
    </Section>
  );
}
