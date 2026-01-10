"use client"

import { useState } from "react"
import Link from "next/link"
import { m } from "framer-motion"
import { LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NAV_LINKS } from "../constants"
import { ModeToggle } from "./mode-toggle"
import { teko } from "@/lib/fonts"

export const NavDesktop = () => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <div className="hidden lg:flex items-center gap-8">
      <nav className="flex items-center gap-6">
        {NAV_LINKS.map((link, index) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "relative text-xl font-medium transition-colors duration-200 py-1 tracking-wide",
              "text-neutral-600 hover:text-black",
              "dark:text-neutral-400 dark:hover:text-white",
              teko.className
            )}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {link.label}
            {hoveredIndex === index && (
              <m.span
                layoutId="nav-underline"
                className="absolute left-0 right-0 -bottom-1 h-[2px] bg-gradient-to-r from-blue-600 to-purple-600 rounded-full"
                initial={{ opacity: 0, width: "0%" }}
                animate={{ opacity: 1, width: "100%" }}
                exit={{ opacity: 0, width: "0%" }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              />
            )}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4 pl-4 border-l border-black/10 dark:border-white/10">
        <ModeToggle />
        <Button
          asChild
          size="sm"
          className={cn(
            "rounded-md px-6 transition-all duration-300 hover:scale-105",
            "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0 shadow-lg shadow-blue-500/20"
          )}
        >
          <Link href="/login" className="flex items-center">
            <LogIn size={16} className="mr-2" />
            <span className={cn("text-xl font-semibold tracking-wide pt-1", teko.className)}>
              LOG IN
            </span>
          </Link>
        </Button>
      </div>
    </div>
  )
}