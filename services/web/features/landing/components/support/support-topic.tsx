import { ArrowUpRight } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { GlassPanel } from "@/components/ui/glass-panel";
import { IconTile } from "@/components/ui/icon-tile";

import { SUPPORT_TEXT, type SupportTopic } from "../../constants";
import { contactMailto } from "../../utils/contact-mailto";

interface SupportTopicCardProps {
  topic: SupportTopic;
  index?: number;
}

export function SupportTopicCard({ topic, index = 0 }: SupportTopicCardProps) {
  return (
    <FadeIn delay={0.2 + index * 0.12} className="h-full">
      <GlassPanel className="flex h-full flex-col">
        <div className="flex flex-1 flex-col p-6">
          <IconTile icon={topic.icon} bordered />
          <h3 className="mt-4 text-base font-semibold">{topic.title}</h3>
          <p className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">
            {topic.description}
          </p>
          <a
            href={contactMailto(topic.subject)}
            className="mt-5 inline-flex w-fit items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {SUPPORT_TEXT.ctaLabel}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
