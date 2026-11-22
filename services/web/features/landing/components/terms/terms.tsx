import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

import { TermsBody } from "./terms-body";
import { TermsContact } from "./terms-contact";
import { TermsHero } from "./terms-hero";

export function Terms() {
  return (
    <Section className="overflow-hidden">
      <Container className="flex flex-col items-center space-y-10 sm:space-y-12">
        <TermsHero />
        <TermsBody />
        <TermsContact />
      </Container>
    </Section>
  );
}
