"use client"

import { useTheme } from "next-themes"
import { Sun, Moon } from "lucide-react"
import { m } from "framer-motion"
import { cn } from "@/lib/utils"

export const ModeToggle = () => {
  const { theme, setTheme } = useTheme()

  return (
    <m.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={cn(
        "relative p-2 rounded-full transition-colors overflow-hidden",
        "bg-black/5 hover:bg-black/10 text-gray-700",
        "dark:bg-white/10 dark:hover:bg-white/20 dark:text-yellow-400"
      )}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Sun
        size={18}
        className="rotate-0 scale-100 transition-all duration-300 dark:-rotate-90 dark:scale-0"
      />
      <Moon
        size={18}
        className="absolute top-2 left-2 rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100"
      />
    </m.button>
  )
}