import { MessageCircle } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { GradientPill } from "@/components/ui/gradient-pill";
import { GradientText } from "@/components/ui/gradient-text";

import { FAQ_TEXT } from "../../constants";

export function FaqHeading() {
  return (
    <FadeIn className="relative z-20 mt-4 w-full space-y-4 text-center">
      <GradientPill icon={MessageCircle}>{FAQ_TEXT.eyebrow}</GradientPill>
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
        <GradientText animate>{FAQ_TEXT.title}</GradientText>
      </h2>
      <p className="mx-auto max-w-2xl font-editorial text-sm leading-relaxed tracking-wide text-foreground sm:text-base">
        {FAQ_TEXT.description}
      </p>
    </FadeIn>
  );
}
