import type { IconSvgElement } from "@hugeicons/react";
import type { LucideIcon } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { GradientPill } from "@/components/ui/gradient-pill";
import { GradientText } from "@/components/ui/gradient-text";

interface LegalHeroProps {
  badge: string;
  title: string;
  description: string;
  icon?: LucideIcon;
  hugeIcon?: IconSvgElement;
}

export function LegalHero({
  badge,
  title,
  description,
  icon,
  hugeIcon,
}: LegalHeroProps) {
  return (
    <FadeIn className="flex w-full flex-col items-center text-center">
      <GradientPill icon={icon} hugeIcon={hugeIcon}>
        {badge}
      </GradientPill>
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
        <GradientText animate>{title}</GradientText>
      </h1>
      <p className="mt-4 max-w-2xl font-editorial text-sm leading-relaxed tracking-wide text-foreground sm:text-base">
        {description}
      </p>
    </FadeIn>
  );
}
