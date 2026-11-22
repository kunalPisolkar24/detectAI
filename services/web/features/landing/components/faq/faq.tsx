import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

import { FaqHeading } from "./faq-heading";
import { FaqList } from "./faq-list";

export function Faq() {
  return (
    <Section id="faq" className="scroll-mt-20 overflow-hidden">
      <Container className="flex flex-col items-center">
        <FaqHeading />
        <FaqList />
      </Container>
    </Section>
  );
}
