import { Star } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { GradientPill } from "@/components/ui/gradient-pill";
import { GradientText } from "@/components/ui/gradient-text";

export function TestimonialsHeading() {
  return (
    <FadeIn className="relative z-20 mt-4 space-y-4 text-center">
      <GradientPill icon={Star}>Testimonials</GradientPill>
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
        <GradientText animate>What Our Users Say</GradientText>
      </h2>
      <p className="mx-auto max-w-3xl font-editorial text-sm leading-relaxed tracking-wide text-foreground sm:text-base">
        <span className="block">See what people are saying about DetectAI.</span>
        <span className="block">
          Read their experiences and find out how it can help you.
        </span>
      </p>
    </FadeIn>
  );
}
