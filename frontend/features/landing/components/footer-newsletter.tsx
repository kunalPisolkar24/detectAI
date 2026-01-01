"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/utils"
import { teko } from "@/lib/fonts"

export const FooterNewsletter = () => {
  return (
    <div className={cn(
      "p-4 rounded-lg mb-6 transition-colors",
      "bg-black/5 border border-black/10",
      "dark:bg-white/5 dark:border-white/10"
    )}>
      <h3 className="text-sm font-semibold mb-2 text-foreground">Stay updated</h3>
      <p className="text-xs mb-3 text-neutral-600 dark:text-neutral-400">
        Subscribe to our newsletter for the latest updates and features.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          placeholder="Your email"
          className={cn(
            "text-sm px-3 py-2 rounded-md w-full outline-none transition-colors",
            "bg-white border border-black/10 text-gray-900 placeholder:text-neutral-400",
            "dark:bg-black/40 dark:border-white/10 dark:text-white dark:placeholder:text-neutral-500",
            "focus:ring-2 focus:ring-blue-500/20"
          )}
        />
        <m.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "px-3 py-2 rounded-md text-xl tracing-wide font-medium transition-colors",
            "bg-blue-600 hover:bg-blue-700 text-white shadow-md",
            "dark:bg-blue-600 dark:hover:bg-blue-500",
            teko.className
          )}
        >
          Subscribe
        </m.button>
      </div>
    </div>
  )
}