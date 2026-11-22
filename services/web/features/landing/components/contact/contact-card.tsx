import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { IconTile } from "@/components/ui/icon-tile";

import { CONTACT_EMAIL, type ContactChannel } from "../../constants";

interface ContactCardProps {
  channel: ContactChannel;
  index?: number;
}

export function ContactCard({ channel, index = 0 }: ContactCardProps) {
  const href = channel.subject
    ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(channel.subject)}`
    : `mailto:${CONTACT_EMAIL}`;

  return (
    <FadeIn delay={0.2 + index * 0.12} className="h-full">
      <GlassPanel className="flex h-full flex-col">
        <div className="flex flex-1 flex-col p-6">
          <IconTile icon={channel.icon} bordered />
          <h3 className="mt-4 text-base font-semibold">{channel.title}</h3>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {channel.tagline}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {channel.description}
          </p>
          <p className="mt-4 break-all text-sm font-medium text-blue-600 dark:text-blue-400">
            {CONTACT_EMAIL}
          </p>
          <Button asChild variant="brand" size="model" className="mt-6 w-full">
            <a href={href}>{channel.cta}</a>
          </Button>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
