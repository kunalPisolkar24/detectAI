"use client"

import { memo } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { teko } from "@/lib/fonts";

const FaqCTA = memo(() => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, delay: 0.8 }}
      className={cn(
        "mt-12 sm:mt-16 text-center p-4 sm:p-6 rounded-xl w-full max-w-2xl mx-auto",
        "bg-white/60 border border-black/10 backdrop-blur-sm",
        "dark:bg-black/40 dark:border-white/10"
      )}
    >
      <h3 className="text-sm sm:text-base md:text-lg font-semibold mb-1 sm:mb-2 text-gray-900 dark:text-white">
        Still have questions?
      </h3>
      <p className="text-xs sm:text-sm md:text-base text-neutral-600 dark:text-neutral-300">
        If you couldn&apos;t find the answer to your question, feel free to reach out to our support team.
      </p>
      <motion.a
        href="/contact"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.97 }}
        className={cn(
          "inline-block mt-3 sm:mt-4 px-4 py-1.5 sm:px-5 sm:py-2 rounded-md font-medium text-md sm:text-2xl transition-all duration-200",
          "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-300/50",
          "dark:hover:bg-blue-500 dark:shadow-blue-900/40", teko.className
        )}
      >
        Contact Support
      </motion.a>
    </motion.div>
  )
})

FaqCTA.displayName = "FaqCTA"
export { FaqCTA }