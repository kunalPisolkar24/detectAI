"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text"
import { Marquee } from "@/components/ui/marquee"
import { cn } from "@/lib/utils"
import { merriweather } from "@/lib/fonts"
import { REVIEWS_DATA } from "./constants"
import { ReviewCard } from "./components/review-card"

export const Testimonials = () => {
  const firstRow = useMemo(() => REVIEWS_DATA.slice(0, REVIEWS_DATA.length / 2), [])
  const secondRow = useMemo(() => REVIEWS_DATA.slice(REVIEWS_DATA.length / 2), [])

  return (
    <section
      id="testimonials"
      className="relative w-full flex flex-col items-center justify-center py-12 mb-10 overflow-hidden px-6 lg:mx-auto transition-colors duration-300"
    >
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="group relative mx-auto flex items-center justify-center rounded-full px-4 py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] transition-shadow duration-500 ease-out hover:shadow-[inset_0_-5px_10px_#8fdfff3f] border border-black/5 dark:border-white/5 bg-background/50 backdrop-blur-md"
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
        <motion.span
          animate={{ rotate: [0, 5, 0] }}
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          className="mr-2"
        >
          ⭐
        </motion.span>
        <AnimatedGradientText className="text-sm font-medium">Testimonials</AnimatedGradientText>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay: 0.2 }}
        className="text-center mt-4 space-y-4 relative z-20"
      >
        <h2 className={cn(
          "text-3xl sm:text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r bg-[length:200%_100%] animate-gradient-x",
          "from-gray-900 via-blue-600 to-gray-900",
          "dark:from-white dark:via-blue-400 dark:to-white"
        )}>
          What Our Users Say
        </h2>

        <p className={cn(
          "max-w-3xl mx-auto text-base text-neutral-600 dark:text-neutral-300 leading-relaxed",
          merriweather.className
        )}>
          See what our users have to say about Detect AI! <br className="hidden sm:block" />
          Read their experiences and discover how Detect AI can benefit you.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1, delay: 0.4 }}
        className="relative flex w-full flex-col items-center justify-center overflow-hidden mt-10 [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]"
      >
        <Marquee pauseOnHover className="[--duration:20s]">
          {firstRow.map((review) => (
            <ReviewCard key={review.username} {...review} />
          ))}
        </Marquee>

        <div className="h-4" />

        <Marquee reverse pauseOnHover className="[--duration:20s]">
          {secondRow.map((review) => (
            <ReviewCard key={review.username} {...review} />
          ))}
        </Marquee>
      </motion.div>

      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 -left-32 w-64 h-64 rounded-full blur-3xl bg-purple-400/20 dark:bg-purple-600/20"
          animate={{
            x: [0, 30, 0],
            y: [0, 20, 0],
          }}
          transition={{
            duration: 15,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className="absolute bottom-1/4 -right-32 w-64 h-64 rounded-full blur-3xl bg-blue-400/20 dark:bg-blue-600/20"
          animate={{
            x: [0, -30, 0],
            y: [0, -20, 0],
          }}
          transition={{
            duration: 18,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </div>
    </section>
  )
}