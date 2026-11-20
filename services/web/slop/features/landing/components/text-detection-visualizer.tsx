"use client"

import { useMemo } from "react"
import { m } from "framer-motion"
import { Zap } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { VISUALIZER_TEXT } from "../constants"

export const TextDetectionVisualizer = () => {
  const words = useMemo(() => VISUALIZER_TEXT.split(" "), [])

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, delay: 0.5 }}
      className={cn(
        "relative mt-12 w-full max-w-3xl mx-auto backdrop-blur-sm rounded-xl p-6 overflow-hidden border shadow-sm",
        "bg-white/70 border-black/10 text-neutral-900",
        "dark:bg-black/50 dark:border-white/10 dark:text-neutral-100"
      )}
    >
      <div className="flex items-center space-x-2 mb-4">
        <Zap className="text-yellow-400 size-5" />
        <span className="text-sm font-medium">AI Detection in Progress</span>
      </div>

      <div className="font-mono text-sm text-left leading-relaxed">
        {words.map((word, index) => {
          const colorClass = index % 5 === 0
            ? "text-blue-600 dark:text-blue-400"
            : index % 7 === 0
              ? "text-purple-600 dark:text-purple-400"
              : "text-black dark:text-white"

          return (
            <m.span
              key={index}
              initial={{ opacity: 0.3 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: 0.2,
                delay: (index * 0.05) % 2,
                repeat: Number.POSITIVE_INFINITY,
                repeatType: "reverse",
              }}
              className={cn("inline-block mr-1 mb-1", colorClass)}
            >
              {word}
            </m.span>
          )
        })}

        <m.div
          className="h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 mt-4 rounded-full"
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        />

        <div className="flex justify-between mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          <span>Analyzing patterns...</span>
          <m.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
          >
            Processing...
          </m.span>
        </div>
      </div>
    </m.div>
  )
}