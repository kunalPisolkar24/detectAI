"use client"

import { memo, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NAV_LINKS } from "../constants"
import { ModeToggle } from "./mode-toggle"

const NavDesktop = memo(() => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <div className="hidden lg:flex items-center gap-6">
      <nav className="flex items-center gap-1 bg-black/5 dark:bg-white/5 px-2 py-1.5 rounded-full border border-black/5 dark:border-white/10 backdrop-blur-sm">
        {NAV_LINKS.map((link, index) => {
          const Icon = link.icon
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "relative px-4 py-2 text-sm font-medium transition-colors rounded-full",
                "text-gray-600 hover:text-black",
                "dark:text-gray-300 dark:hover:text-white"
              )}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <span className="relative z-10 flex items-center gap-2">
                <Icon size={14} className="opacity-70" />
                {link.label}
              </span>
              {hoveredIndex === index && (
                <motion.span
                  layoutId="nav-pill"
                  className={cn(
                    "absolute inset-0 rounded-full -z-0",
                    "bg-white shadow-sm",
                    "dark:bg-white/10"
                  )}
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
            </Link>
          )
        })}
      </nav>

      <div className="flex items-center gap-3">
        <ModeToggle />
        <Button
          asChild
          className={cn(
            "rounded-full font-semibold px-6 shadow-lg shadow-blue-500/20 transition-all hover:scale-105",
            "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0"
          )}
        >
          <Link href="/login">
            <LogIn size={16} className="mr-2" />
            Log in
          </Link>
        </Button>
      </div>
    </div>
  )
})

NavDesktop.displayName = "NavDesktop"
export { NavDesktop }