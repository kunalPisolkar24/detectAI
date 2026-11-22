import { FadeIn } from "@/components/motion/fade-in";
import { BrandLogo } from "@/components/ui/brand-logo";

import { FOOTER_TEXT } from "../../constants";
import { FooterSocials } from "./footer-socials";

export function FooterBrand() {
  return (
    <FadeIn className="space-y-4 md:col-span-2">
      <BrandLogo size="md" />
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        {FOOTER_TEXT.description}
      </p>
      <FooterSocials />
    </FadeIn>
  );
}
