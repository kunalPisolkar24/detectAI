import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

import { ContactChannels } from "./contact-channels";
import { ContactCta } from "./contact-cta";
import { ContactHero } from "./contact-hero";

export function Contact() {
  return (
    <Section className="overflow-hidden">
      <Container className="flex flex-col items-center space-y-12 sm:space-y-16">
        <ContactHero />
        <ContactChannels />
        <ContactCta />
      </Container>
    </Section>
  );
}
