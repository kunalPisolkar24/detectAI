import { ListOrdered } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { GlassPanel } from "@/components/ui/glass-panel";

import { TERMS_SECTIONS, TERMS_TEXT } from "../../constants";

export function TermsToc() {
  return (
    <FadeIn className="lg:sticky lg:top-24 lg:col-span-4 lg:self-start">
      <nav aria-label="Table of contents">
        <GlassPanel>
          <div className="p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ListOrdered
                className="size-4 text-blue-600 dark:text-blue-400"
                aria-hidden="true"
              />
              {TERMS_TEXT.tocTitle}
            </p>
            <ol className="mt-3 space-y-2">
              {TERMS_SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="group flex items-baseline gap-2 text-sm text-muted-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    <span className="text-xs tabular-nums opacity-50">{index + 1}.</span>
                    <span className="leading-snug group-hover:underline group-hover:underline-offset-4">
                      {section.title}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </GlassPanel>
      </nav>
    </FadeIn>
  );
}
