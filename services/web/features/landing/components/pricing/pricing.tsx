import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

import { PricingHeading } from "./pricing-heading";
import { PricingPlans } from "./pricing-plans";

export function Pricing() {
  return (
    <Section id="pricing" className="scroll-mt-20 overflow-hidden">
      <Container className="flex flex-col items-center">
        <PricingHeading />
      </Container>
      <PricingPlans />
    </Section>
  );
}
