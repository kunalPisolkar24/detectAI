"use client"

import { memo } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { BotIcon } from "lucide-react"
import { teko } from "@/lib/fonts"
import { cn } from "@/lib/utils"

const NavLogo = memo(() => {
  return (
    <Link href="/" className="flex items-center gap-2 group">
      <motion.div 
        whileHover={{ rotate: 10, scale: 1.1 }} 
        transition={{ type: "spring", stiffness: 400, damping: 10 }}
      >
        <BotIcon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
      </motion.div>
      <span className={cn(
        "text-3xl font-medium tracking-wide transition-colors mt-2",
        "text-gray-900 group-hover:text-blue-600",
        "dark:text-white dark:group-hover:text-blue-400"
      , teko.className)}>
        Detect AI
      </span>
    </Link>
  )
})

NavLogo.displayName = "NavLogo"
export { NavLogo }