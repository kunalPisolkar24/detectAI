import { FadeIn } from "@/components/motion/fade-in";

import { SUPPORT_TEXT, SUPPORT_TOPICS } from "../../constants";
import { SupportTopicCard } from "./support-topic";

export function SupportTopics() {
  return (
    <section className="w-full max-w-5xl">
      <FadeIn>
        <h2 className="text-center text-2xl font-semibold">
          {SUPPORT_TEXT.topicsTitle}
        </h2>
      </FadeIn>
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {SUPPORT_TOPICS.map((topic, index) => (
          <SupportTopicCard key={topic.id} topic={topic} index={index} />
        ))}
      </div>
    </section>
  );
}
