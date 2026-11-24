import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HERO_TEXT } from "../../constants";

export function HeroCta() {
  return (
    <Button asChild variant="brand" size="hero">
      <Link href={HERO_TEXT.ctaHref}>
        <span className="inline-block translate-y-0.5">{HERO_TEXT.cta}</span>
        <ArrowRight className="ml-2 size-5" />
      </Link>
    </Button>
  );
}
