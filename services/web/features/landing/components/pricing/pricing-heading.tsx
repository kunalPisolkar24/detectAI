import { CreditCard } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { GradientPill } from "@/components/ui/gradient-pill";
import { GradientText } from "@/components/ui/gradient-text";

import { PRICING_TEXT } from "../../constants";

export function PricingHeading() {
  return (
    <FadeIn className="relative z-20 mt-4 space-y-4 text-center">
      <GradientPill icon={CreditCard}>{PRICING_TEXT.eyebrow}</GradientPill>
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
        <GradientText animate>{PRICING_TEXT.title}</GradientText>
      </h2>
      <p className="mx-auto max-w-3xl font-editorial text-sm leading-relaxed tracking-wide text-muted-foreground sm:text-base">
        {PRICING_TEXT.description.map((line) => (
          <span className="block" key={line}>
            {line}
          </span>
        ))}
      </p>
    </FadeIn>
  );
}
