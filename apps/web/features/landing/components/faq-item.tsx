"use client"

import { memo } from "react"
import { m } from "framer-motion"
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { cn } from "@/lib/core/utils"
import { merriweather } from "@/lib/core/fonts"

interface FaqItemProps {
  question: string
  answer: string
  index: number
}

const FaqItem = memo(({ question, answer, index }: FaqItemProps) => {
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: 0.3 + index * 0.08 }}
    >
      <AccordionItem
        value={question}
        className={cn(
          "border rounded-lg mb-3 overflow-hidden transition-all duration-300",
          "border-black/10 bg-white/70 backdrop-blur-sm hover:bg-white/80",
          "dark:border-white/10 dark:bg-black/50 dark:hover:bg-black/60"
        )}
      >
        <AccordionTrigger
          className={cn(
            "text-left px-4 py-3 font-medium text-xs sm:text-sm md:text-base hover:no-underline",
            "text-gray-800 hover:text-gray-950",
            "dark:text-white dark:hover:text-neutral-200"
          )}
        >
          {question}
        </AccordionTrigger>
        <AccordionContent
          className={cn(
            "px-4 pb-3 sm:pb-4 text-xs sm:text-sm md:text-base leading-relaxed",
            "text-neutral-600 dark:text-neutral-300",
            merriweather.className
          )}
        >
          {answer}
        </AccordionContent>
      </AccordionItem>
    </m.div>
  )
})

FaqItem.displayName = "FaqItem"
export { FaqItem }