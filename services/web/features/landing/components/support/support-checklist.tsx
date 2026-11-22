import { ListChecks } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { BulletList } from "@/components/ui/bullet-list";
import { GlassPanel } from "@/components/ui/glass-panel";
import { IconTile } from "@/components/ui/icon-tile";

import { SUPPORT_CHECKLIST, SUPPORT_TEXT } from "../../constants";

export function SupportChecklist() {
  return (
    <FadeIn delay={0.5} className="w-full max-w-3xl">
      <GlassPanel>
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <IconTile icon={ListChecks} tone="purple" bordered />
            <h2 className="text-lg font-semibold">{SUPPORT_TEXT.checklistTitle}</h2>
          </div>
          <div className="mt-5 text-sm leading-relaxed text-foreground">
            <BulletList items={SUPPORT_CHECKLIST} />
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
