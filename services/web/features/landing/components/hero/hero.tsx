import { Container } from "@/components/layout/container";
import { FadeIn } from "@/components/motion/fade-in";

import { HeroBackground } from "./hero-background";
import { HeroBadge } from "./hero-badge";
import { HeroCta } from "./hero-cta";
import { HeroHeadline } from "./hero-headline";
import { TextDetectionVisualizer } from "./text-detection-visualizer";

export function HeroSection() {
  return (
    <section className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background text-foreground transition-colors duration-300">
      <HeroBackground />

      <Container className="relative z-10 mb-10 mt-32 flex flex-col items-center justify-center space-y-8 text-center">
        <FadeIn>
          <HeroBadge />
        </FadeIn>

        <FadeIn delay={0.2}>
          <HeroHeadline />
        </FadeIn>

        <FadeIn delay={0.4}>
          <HeroCta />
        </FadeIn>

        <TextDetectionVisualizer />
      </Container>
    </section>
  );
}
