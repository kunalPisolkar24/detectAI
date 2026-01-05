"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/utils"
import { teko } from "@/lib/fonts"

export interface AuthHeaderProps {
  label: string
  title: string
}

export const AuthHeader = ({ label, title }: AuthHeaderProps) => {
  return (
    <div className="w-full flex flex-col items-center justify-center gap-2 text-center">
      <m.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "text-sm px-3 py-1 rounded-full font-medium tracking-wide",
          "bg-blue-100/50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
        )}
      >
        {label}
      </m.div>

      <m.h1
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className={cn(
          "text-4xl font-bold tracking-wide",
          "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900",
          "dark:from-white dark:via-blue-400 dark:to-white animate-gradient-x",
          teko.className
        )}
      >
        {title}
      </m.h1>
    </div>
  )
}