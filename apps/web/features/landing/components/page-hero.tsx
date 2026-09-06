"use client"

import { m } from "framer-motion"
import type { LucideIcon } from "lucide-react"
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text"
import { cn } from "@/lib/core/utils"
import { merriweather } from "@/lib/core/fonts"

interface PageHeroProps {
  badge: string
  icon: LucideIcon
  title: string
  description: string
}

export const PageHero = ({ badge, icon: Icon, title, description }: PageHeroProps) => {
  return (
    <div className="text-center flex flex-col items-center justify-center">
      <m.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="group relative mx-auto flex items-center justify-center rounded-full px-4 py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] border border-black/5 dark:border-white/5 bg-background/50 backdrop-blur-md"
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
        <Icon className="mr-2 h-4 w-4 text-blue-500 dark:text-blue-400" />
        <AnimatedGradientText className="text-sm font-medium">{badge}</AnimatedGradientText>
      </m.div>

      <m.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.15 }}
        className={cn(
          "mt-4 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-center bg-clip-text text-transparent bg-gradient-to-r bg-[length:200%_100%] animate-gradient-x",
          "from-gray-900 via-blue-600 to-gray-900",
          "dark:from-white dark:via-blue-400 dark:to-white"
        )}
      >
        {title}
      </m.h1>

      <m.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.25 }}
        className={cn(
          "text-base max-w-xl mt-4 text-neutral-600 dark:text-neutral-300",
          merriweather.className
        )}
      >
        {description}
      </m.p>
    </div>
  )
}
