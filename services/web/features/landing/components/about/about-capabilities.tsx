import { FadeIn } from "@/components/motion/fade-in";

import { ABOUT_CAPABILITIES, ABOUT_TEXT } from "../../constants";
import { AboutCard } from "./about-card";

export function AboutCapabilities() {
  return (
    <section className="w-full max-w-5xl">
      <FadeIn>
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          {ABOUT_TEXT.capabilitiesTitle}
        </h2>
      </FadeIn>
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {ABOUT_CAPABILITIES.map((capability, index) => (
          <AboutCard key={capability.id} card={capability} index={index} />
        ))}
      </div>
    </section>
  );
}
