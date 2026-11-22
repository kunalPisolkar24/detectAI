import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

import { SupportChecklist } from "./support-checklist";
import { SupportHero } from "./support-hero";
import { SupportTopics } from "./support-topics";

export function Support() {
  return (
    <Section className="overflow-hidden">
      <Container className="flex flex-col items-center space-y-12 sm:space-y-16">
        <SupportHero />
        <SupportTopics />
        <SupportChecklist />
      </Container>
    </Section>
  );
}
