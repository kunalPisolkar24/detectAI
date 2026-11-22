import { Mail } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { IconTile } from "@/components/ui/icon-tile";

import { contactMailto } from "../../utils/contact-mailto";

interface LegalContactProps {
  title: string;
  description: string;
  subject: string;
  ctaLabel: string;
}

export function LegalContact({
  title,
  description,
  subject,
  ctaLabel,
}: LegalContactProps) {
  return (
    <FadeIn delay={0.5} className="w-full max-w-3xl text-center sm:text-left">
      <GlassPanel>
        <div className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:p-8">
          <IconTile icon={Mail} tone="purple" bordered />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground">
              {description}
            </p>
          </div>
          <Button asChild variant="brand" size="cta">
            <a href={contactMailto(subject)}>{ctaLabel}</a>
          </Button>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
