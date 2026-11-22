import { BubbleChatUserIcon } from "@hugeicons/core-free-icons";

import { FadeIn } from "@/components/motion/fade-in";
import { GradientPill } from "@/components/ui/gradient-pill";
import { GradientText } from "@/components/ui/gradient-text";

import { CONTACT_TEXT } from "../../constants";

export function ContactHero() {
  return (
    <FadeIn className="flex w-full flex-col items-center text-center">
      <GradientPill hugeIcon={BubbleChatUserIcon}>{CONTACT_TEXT.badge}</GradientPill>
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
        <GradientText animate>{CONTACT_TEXT.title}</GradientText>
      </h1>
      <p className="mt-4 max-w-2xl font-editorial text-sm leading-relaxed tracking-wide text-foreground sm:text-base">
        {CONTACT_TEXT.description}
      </p>
    </FadeIn>
  );
}
