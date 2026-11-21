import { ChevronRight, Rocket } from "lucide-react";

import { GradientPill } from "@/components/ui/gradient-pill";
import { HERO_TEXT } from "../../constants";

export function HeroBadge() {
  return (
    <GradientPill icon={Rocket} className="group">
      {HERO_TEXT.badge}
      <ChevronRight className="ml-1 size-4 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5" />
    </GradientPill>
  );
}
