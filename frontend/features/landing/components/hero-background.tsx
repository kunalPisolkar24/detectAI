"use client"

import { memo } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

const HeroBackground = memo(() => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className={cn(
        "absolute inset-0 opacity-20 animate-gradient-slow",
        "bg-gradient-to-r from-purple-300/30 via-blue-300/30 to-cyan-300/30",
        "dark:from-purple-500/20 dark:via-blue-500/20 dark:to-cyan-500/20"
      )} />

      <motion.div
        className={cn(
          "absolute top-1/4 -left-32 w-96 h-96 rounded-full blur-3xl opacity-30",
          "bg-purple-400 dark:bg-purple-600"
        )}
        animate={{
          x: [0, 50, 0],
          y: [0, 30, 0],
        }}
        transition={{
          duration: 15,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />

      <motion.div
        className={cn(
          "absolute bottom-1/4 -right-32 w-96 h-96 rounded-full blur-3xl opacity-30",
          "bg-blue-400 dark:bg-blue-600"
        )}
        animate={{
          x: [0, -50, 0],
          y: [0, -30, 0],
        }}
        transition={{
          duration: 18,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
    </div>
  )
})

HeroBackground.displayName = "HeroBackground"
export { HeroBackground }