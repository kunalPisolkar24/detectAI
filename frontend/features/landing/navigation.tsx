"use client"

import { useState } from "react"
import { motion, useScroll, useMotionValueEvent } from "framer-motion"
import { cn } from "@/lib/utils"
import { NavLogo } from "./components/nav-logo"
import { NavDesktop } from "./components/nav-desktop"
import { NavMobile } from "./components/nav-mobile"

export const Navigation = () => {
  const { scrollY } = useScroll()
  const [isScrolled, setIsScrolled] = useState(false)

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = isScrolled
    const current = latest > 10
    if (previous !== current) {
      setIsScrolled(current)
    }
  })

  return (
    <motion.header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        isScrolled
          ? "py-3 bg-white/80 dark:bg-black/80 backdrop-blur-md border-b border-black/5 dark:border-white/5 shadow-sm"
          : "py-5 bg-transparent"
      )}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <div className="container mx-auto px-6 flex items-center justify-between">
        <NavLogo />
        <NavDesktop />
        <NavMobile />
      </div>
    </motion.header>
  )
}