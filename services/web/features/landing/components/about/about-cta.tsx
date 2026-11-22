import Link from "next/link";

import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";

import { ABOUT_TEXT } from "../../constants";

export function AboutCta() {
  return (
    <FadeIn delay={0.5} className="w-full max-w-2xl text-center">
      <GlassPanel>
        <div className="p-6 sm:p-8">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {ABOUT_TEXT.ctaTitle}
          </h2>
          <p className="mt-2 text-sm text-foreground sm:text-base">
            {ABOUT_TEXT.ctaDescription}
          </p>
          <Button asChild variant="brand" size="pricing" className="mt-5">
            <Link href="/signup">{ABOUT_TEXT.ctaLabel}</Link>
          </Button>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
