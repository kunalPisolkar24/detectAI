import Link from "next/link";

import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { IconLink } from "@/components/ui/icon-link";

import { CONTACT_TEXT, FOOTER_SOCIALS } from "../../constants";

export function ContactCta() {
  return (
    <FadeIn delay={0.5} className="w-full max-w-2xl text-center">
      <GlassPanel>
        <div className="p-6 sm:p-8">
          <h2 className="text-lg font-semibold">{CONTACT_TEXT.ctaTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground sm:text-base">
            {CONTACT_TEXT.ctaDescription}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="brand" size="cta">
              <Link href="/support">{CONTACT_TEXT.ctaLabel}</Link>
            </Button>
            <div className="flex flex-wrap items-center gap-3">
              {FOOTER_SOCIALS.map((social) => (
                <IconLink
                  key={social.name}
                  href={social.href}
                  hugeIcon={social.icon}
                  label={social.name}
                  external={!social.href.startsWith("mailto:")}
                />
              ))}
            </div>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
