import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

import { AboutCapabilities } from "./about-capabilities";
import { AboutCta } from "./about-cta";
import { AboutHero } from "./about-hero";
import { AboutModels } from "./about-models";
import { AboutStory } from "./about-story";

export function About() {
  return (
    <Section className="overflow-hidden">
      <Container className="flex flex-col items-center space-y-12 sm:space-y-16">
        <AboutHero />
        <AboutStory />
        <AboutModels />
        <AboutCapabilities />
        <AboutCta />
      </Container>
    </Section>
  );
}
