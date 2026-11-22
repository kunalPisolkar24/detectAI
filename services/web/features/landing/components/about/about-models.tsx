import { FadeIn } from "@/components/motion/fade-in";

import { ABOUT_MODELS, ABOUT_TEXT } from "../../constants";
import { AboutCard } from "./about-card";

export function AboutModels() {
  return (
    <section className="w-full max-w-5xl">
      <FadeIn>
        <h2 className="text-center text-2xl font-semibold">
          {ABOUT_TEXT.modelsTitle}
        </h2>
      </FadeIn>
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:gap-8">
        {ABOUT_MODELS.map((model, index) => (
          <AboutCard key={model.id} card={model} index={index} />
        ))}
      </div>
    </section>
  );
}
