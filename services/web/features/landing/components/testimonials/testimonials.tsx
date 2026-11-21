import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { FadeIn } from "@/components/motion/fade-in";

import { REVIEWS_DATA } from "../../constants";
import { TestimonialsHeading } from "./testimonials-heading";
import { TestimonialsMarquee } from "./testimonials-marquee";

const firstRow = REVIEWS_DATA.slice(0, REVIEWS_DATA.length / 2);
const secondRow = REVIEWS_DATA.slice(REVIEWS_DATA.length / 2);

export function Testimonials() {
  return (
    <Section id="testimonials" className="overflow-hidden">
      <Container className="flex flex-col items-center">
        <TestimonialsHeading />
      </Container>

      <FadeIn delay={0.4} className="mt-10 w-full">
        <TestimonialsMarquee reviews={firstRow} />
        <div className="h-4" />
        <TestimonialsMarquee reviews={secondRow} reverse />
      </FadeIn>
    </Section>
  );
}
