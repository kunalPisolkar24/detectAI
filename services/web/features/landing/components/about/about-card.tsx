import Link from "next/link";

import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { IconTile } from "@/components/ui/icon-tile";

import type { AboutCardData } from "../../constants";

interface AboutCardProps {
  card: AboutCardData;
  index?: number;
}

export function AboutCard({ card, index = 0 }: AboutCardProps) {
  return (
    <FadeIn delay={0.2 + index * 0.12} className="h-full">
      <GlassPanel
        elevated={card.featured}
        brand={card.featured}
        className="flex h-full flex-col overflow-hidden"
      >
        <div className="flex flex-1 flex-col p-6">
          <IconTile icon={card.icon} tone="brand" size="md" />
          <h3 className="mt-4 text-base font-semibold">{card.name}</h3>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {card.tagline}
          </p>

          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {card.description}
          </p>

          {card.cta && (
            <Button
              asChild
              variant={card.featured ? "brand" : "outline"}
              size="pricing"
              className="mt-6 w-full"
            >
              <Link href={card.cta.href}>{card.cta.label}</Link>
            </Button>
          )}
        </div>

        {card.featured && (
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-purple-500" />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
