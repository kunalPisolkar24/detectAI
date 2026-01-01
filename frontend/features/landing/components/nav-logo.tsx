"use client"

import Link from "next/link"
import { m } from "framer-motion"
import { BotIcon } from "lucide-react"
import { teko } from "@/lib/fonts"
import { cn } from "@/lib/utils"

export const NavLogo = () => {
  return (
    <Link href="/" className="flex items-center gap-2 group">
      <m.div 
        whileHover={{ rotate: 10, scale: 1.1 }} 
        transition={{ type: "spring", stiffness: 400, damping: 10 }}
      >
        <BotIcon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
      </m.div>
      <span className={cn(
        "text-3xl font-medium tracking-wide transition-colors mt-2",
        "text-gray-900 group-hover:text-blue-600",
        "dark:text-white dark:group-hover:text-blue-400"
      , teko.className)}>
        Detect AI
      </span>
    </Link>
  )
}