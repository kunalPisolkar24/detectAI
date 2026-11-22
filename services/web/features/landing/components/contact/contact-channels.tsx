import { FadeIn } from "@/components/motion/fade-in";

import { CONTACT_CHANNELS, CONTACT_TEXT } from "../../constants";
import { ContactCard } from "./contact-card";

export function ContactChannels() {
  return (
    <section className="w-full max-w-4xl">
      <FadeIn>
        <h2 className="text-center text-2xl font-semibold">
          {CONTACT_TEXT.channelsTitle}
        </h2>
      </FadeIn>
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:gap-8">
        {CONTACT_CHANNELS.map((channel, index) => (
          <ContactCard key={channel.id} channel={channel} index={index} />
        ))}
      </div>
    </section>
  );
}
