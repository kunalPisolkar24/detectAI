import { FadeIn } from "@/components/motion/fade-in";
import { BulletList } from "@/components/ui/bullet-list";
import { GlassPanel } from "@/components/ui/glass-panel";

import type { TermsSection as TermsSectionData } from "../../constants";

interface TermsSectionProps {
  section: TermsSectionData;
  index: number;
}

export function TermsSection({ section, index }: TermsSectionProps) {
  return (
    <FadeIn
      id={section.id}
      delay={Math.min(index * 0.05, 0.3)}
      className="scroll-mt-24"
    >
      <GlassPanel aria-labelledby={`${section.id}-heading`}>
        <div className="p-6 sm:p-8">
          <h2
            id={`${section.id}-heading`}
            className="flex items-baseline gap-3 text-lg font-semibold"
          >
            <span
              aria-hidden="true"
              className="text-sm tabular-nums text-blue-600 dark:text-blue-400"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            {section.title}
          </h2>
          <div className="mt-4 space-y-4 font-editorial text-sm leading-relaxed text-foreground sm:text-base">
            {section.blocks.map((block, blockIndex) =>
              block.type === "paragraph" ? (
                <p key={blockIndex}>{block.text}</p>
              ) : (
                <BulletList key={blockIndex} items={block.items} />
              ),
            )}
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
