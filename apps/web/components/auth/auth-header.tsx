"use client"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"
import { cn } from "@workspace/ui/lib/utils"

export interface AuthHeaderProps {
  label: string
  title: string
}

export const AuthHeader = ({ label, title }: AuthHeaderProps) => {
  const { theme } = useTheme()

  return (
    <div className="w-full flex flex-col items-center justify-center gap-2">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "text-sm px-3 py-1 rounded-full",
          theme === "dark" ? "bg-white/10 text-white" : "bg-black/5 text-black",
        )}
      >
        {label}
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className={cn(
          "text-2xl font-bold tracking-tight",
          theme === "dark"
            ? "bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-white bg-[length:200%_100%]"
            : "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900 bg-[length:200%_100%]",
        )}
        style={{
          backgroundPosition: "0% 0%",
          animation: "gradientMove 5s linear infinite",
        }}
      >
        {title}
      </motion.h1>
    </div>
  )
}

