import { FadeIn } from "@/components/motion/fade-in";
import { GlassPanel } from "@/components/ui/glass-panel";

import { ABOUT_TEXT } from "../../constants";

export function AboutStory() {
  return (
    <FadeIn delay={0.2} className="w-full max-w-3xl">
      <GlassPanel>
        <div className="p-6 sm:p-8">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {ABOUT_TEXT.storyTitle}
          </h2>
          <div className="mt-4 space-y-4 font-editorial text-sm leading-relaxed text-foreground sm:text-base">
            {ABOUT_TEXT.story.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
