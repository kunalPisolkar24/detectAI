"use client";

import { FadeIn } from "@/components/motion/fade-in";
import { Accordion } from "@/components/ui/accordion";
import { GlassPanel } from "@/components/ui/glass-panel";

import { FAQ_ITEMS } from "../../constants";
import { FaqItem } from "./faq-item";

export function FaqList() {
  return (
    <FadeIn delay={0.3} className="mt-10 w-full max-w-3xl">
      <GlassPanel className="overflow-hidden">
        <Accordion type="single" collapsible>
          {FAQ_ITEMS.map((item) => (
            <FaqItem key={item.question} item={item} />
          ))}
        </Accordion>
      </GlassPanel>
    </FadeIn>
  );
}
