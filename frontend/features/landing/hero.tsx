"use client"

import Link from "next/link"
import { ArrowRight, ChevronRight } from "lucide-react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { HeroBackground } from "./components/hero-background"
import { TextDetectionVisualizer } from "./components/text-detection-visualizer"
import { HERO_TEXT } from "./constants"

export const HeroSection = () => {
  return (
    <section className="w-full relative overflow-hidden min-h-screen flex flex-col items-center justify-center bg-background text-foreground transition-colors duration-300">
      <HeroBackground />

      <div className="relative w-full max-w-5xl mx-auto flex flex-col items-center justify-center space-y-8 text-center z-40 px-4 sm:px-6 mt-32 mb-10">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className={cn(
            "group relative mx-auto flex items-center justify-center rounded-full px-4 py-1.5 transition-all duration-500 ease-out border",
            "bg-background/40 backdrop-blur-md border-neutral-200 dark:border-neutral-800",
            "hover:border-purple-500/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.15)]"
          )}
        >
          <motion.span
            animate={{ rotate: [0, 15, 0] }}
            transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            className="mr-2"
          >
            🚀
          </motion.span>
          <span className="text-sm font-medium bg-clip-text text-transparent bg-gradient-to-r from-neutral-600 to-neutral-900 dark:from-neutral-100 dark:to-neutral-400">
            {HERO_TEXT.badge}
          </span>
          <ChevronRight className="ml-1 size-4 text-neutral-500 transition-transform duration-300 ease-in-out group-hover:translate-x-0.5" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="space-y-4"
        >
          <h1 className="text-4xl sm:text-6xl lg:text-8xl font-extrabold tracking-tighter">
            <span className={cn(
              "bg-clip-text text-transparent bg-gradient-to-r bg-[length:200%_100%] animate-gradient-x",
              "from-gray-900 via-blue-600 to-gray-900",
              "dark:from-white dark:via-blue-400 dark:to-white"
            )}>
              {HERO_TEXT.titleStart}
            </span>
            <span className="block mt-2">{HERO_TEXT.titleEnd}</span>
          </h1>

          <p className="mx-auto max-w-2xl text-xl text-neutral-600 dark:text-neutral-300 px-4 sm:px-6 leading-relaxed">
            {HERO_TEXT.description}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Button
            asChild
            size="lg"
            className={cn(
              "rounded-full text-base h-12 px-8 border-0 shadow-lg transition-all",
              "bg-gradient-to-r from-blue-600 to-purple-600 text-white",
              "hover:from-blue-700 hover:to-purple-700 hover:shadow-blue-500/25"
            )}
          >
            <Link href="/signup">
              {HERO_TEXT.cta}
              <ArrowRight className="ml-2 size-5" />
            </Link>
          </Button>
        </motion.div>

        <TextDetectionVisualizer />
      </div>
    </section>
  )
}