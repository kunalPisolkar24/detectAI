import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import type { FaqItemData } from "../../constants";

interface FaqItemProps {
  item: FaqItemData;
}

export function FaqItem({ item }: FaqItemProps) {
  return (
    <AccordionItem value={item.question}>
      <div className="px-5">
        <AccordionTrigger>{item.question}</AccordionTrigger>
        <AccordionContent>
          <p className="py-2 font-editorial leading-relaxed text-foreground">
            {item.answer}
          </p>
        </AccordionContent>
      </div>
    </AccordionItem>
  );
}
