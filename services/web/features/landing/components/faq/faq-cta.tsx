import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";

import { FAQ_TEXT } from "../../constants";

export function FaqCta() {
  return (
    <FadeIn delay={0.5} className="mt-12 w-full max-w-2xl">
      <GlassPanel>
        <div className="p-6 text-center">
          <h3 className="text-lg font-semibold">{FAQ_TEXT.ctaTitle}</h3>
          <p className="mt-2 text-sm leading-relaxed text-foreground sm:text-base">
            {FAQ_TEXT.ctaDescription}
          </p>
          <Button asChild variant="blue" size="lg" className="mt-4">
            <a href={`mailto:${FAQ_TEXT.supportEmail}`}>{FAQ_TEXT.ctaLabel}</a>
          </Button>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
