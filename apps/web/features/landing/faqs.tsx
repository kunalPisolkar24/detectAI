"use client"

import { m } from "framer-motion"
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text"
import { Accordion } from "@/components/ui/accordion"
import { cn } from "@/lib/core/utils"
import { merriweather } from "@/lib/core/fonts"
import { FAQS_LIST } from "./constants"
import { FaqItem } from "./components/faq-item"
import { FaqCTA } from "./components/faq-cta"

export const Faqs = () => {
  return (
    <section
      id="faqs"
      className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-background text-foreground transition-colors duration-300 py-16 md:py-24 px-4 sm:px-6 lg:px-8"
    >
      <div className="absolute inset-0 -z-10 overflow-hidden opacity-15 sm:opacity-20 pointer-events-none">
        <m.div
          className="absolute top-1/4 -left-24 w-72 h-72 sm:w-[500px] sm:h-[500px] sm:-left-40 rounded-full blur-3xl bg-purple-400/20 dark:bg-purple-600/20"
          animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
          transition={{ duration: 20, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <m.div
          className="absolute bottom-1/4 -right-24 w-72 h-72 sm:w-[500px] sm:h-[500px] sm:-right-40 rounded-full blur-3xl bg-blue-400/20 dark:bg-blue-600/20"
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
          transition={{ duration: 23, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
      </div>

      <m.div
        initial={{ opacity: 0, y: -20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="group relative mx-auto flex items-center justify-center rounded-full px-3 py-1 sm:px-4 sm:py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] transition-shadow duration-500 ease-out hover:shadow-[inset_0_-5px_10px_#8fdfff3f] mb-4 sm:mb-5 border border-black/5 dark:border-white/5 bg-background/50 backdrop-blur-md"
      >
        <span
          className={cn(
            "absolute inset-0 block h-full w-full animate-gradient rounded-[inherit] bg-gradient-to-r from-[#ffaa40]/50 via-[#9c40ff]/50 to-[#ffaa40]/50 bg-[length:300%_100%] p-[1px]",
          )}
          style={{
            WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "destination-out",
            mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            maskComposite: "subtract",
            WebkitClipPath: "padding-box",
          }}
        />
        <m.span
          animate={{ rotate: [0, 5, 0] }}
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          className="mr-1.5 sm:mr-2"
        >
          💬
        </m.span>
        <AnimatedGradientText className="text-xs sm:text-sm font-medium">FAQs</AnimatedGradientText>
      </m.div>

      <m.h2
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay: 0.1 }}
        className={cn(
          "text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-center bg-clip-text text-transparent bg-gradient-to-r bg-[length:200%_100%] animate-gradient-x",
          "from-gray-900 via-blue-600 to-gray-900",
          "dark:from-white dark:via-blue-400 dark:to-white"
        )}
      >
        Frequently Asked Questions
      </m.h2>

      <m.p
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay: 0.2 }}
        className={cn(
          "max-w-xl md:max-w-2xl mx-auto mt-2 sm:mt-3 md:mt-4 text-center text-sm md:text-base text-neutral-600 dark:text-neutral-300 tracking-wide",
          merriweather.className
        )}
      >
        Here are some of the most frequently asked questions about our product.
      </m.p>

      <m.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay: 0.3 }}
        className="w-full max-w-3xl mx-auto mt-8 sm:mt-10 md:mt-12"
      >
        <Accordion type="single" collapsible className="w-full">
          {FAQS_LIST.map((faq, index) => (
            <FaqItem
              key={index}
              question={faq.question}
              answer={faq.answer}
              index={index}
            />
          ))}
        </Accordion>
      </m.div>

      <FaqCTA />
    </section>
  )
}