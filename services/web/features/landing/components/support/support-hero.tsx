import { CustomerSupportIcon } from "@hugeicons/core-free-icons";

import { FadeIn } from "@/components/motion/fade-in";
import { GradientPill } from "@/components/ui/gradient-pill";
import { GradientText } from "@/components/ui/gradient-text";

import { SUPPORT_TEXT } from "../../constants";

export function SupportHero() {
  return (
    <FadeIn className="flex w-full flex-col items-center text-center">
      <GradientPill hugeIcon={CustomerSupportIcon}>{SUPPORT_TEXT.badge}</GradientPill>
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
        <GradientText animate>{SUPPORT_TEXT.title}</GradientText>
      </h1>
      <p className="mt-4 max-w-2xl font-editorial text-sm leading-relaxed tracking-wide text-foreground sm:text-base">
        {SUPPORT_TEXT.description}
      </p>
    </FadeIn>
  );
}
