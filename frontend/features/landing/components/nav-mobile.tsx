"use client"

import { memo, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { PanelRight, X, LogIn } from "lucide-react"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NAV_LINKS } from "../constants"
import { NavLogo } from "./nav-logo"
import { ModeToggle } from "./mode-toggle"
import { teko } from "@/lib/fonts"

const NavMobile = memo(() => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <div className="lg:hidden flex items-center gap-3">
        <ModeToggle />
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <PanelRight className="h-6 w-6" />
          </Button>
        </SheetTrigger>
      </div>

      <SheetContent
        className={cn(
          "w-full sm:max-w-md p-6 border-l [&>button]:hidden",
          "bg-white/95 backdrop-blur-xl border-black/10 text-gray-900",
          "dark:bg-black/95 dark:border-white/10 dark:text-white"
        )}
      >
        <SheetTitle className="sr-only">Mobile Navigation</SheetTitle>
        
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between mb-8">
            <NavLogo />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="rounded-full hover:bg-black/5 dark:hover:bg-white/10 border border-transparent hover:border-black/10 dark:hover:border-white/10"
            >
              <X className="h-6 w-6" />
            </Button>
          </div>

          <nav className="flex flex-col gap-2">
            {NAV_LINKS.map((link, index) => {
              const Icon = link.icon
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="group"
                >
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + index * 0.05 }}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl transition-all",
                      "hover:bg-black/5 dark:hover:bg-white/5"
                    )}
                  >
                    <div className={cn(
                      "p-2 rounded-lg transition-colors",
                      "bg-blue-100/50 text-blue-600",
                      "dark:bg-blue-900/20 dark:text-blue-400 group-hover:dark:bg-blue-900/40"
                    )}>
                      <Icon size={20} />
                    </div>
                    <span className={cn("font-medium text-2xl tracking-wide pt-1", teko.className)}>
                      {link.label.toUpperCase()}
                    </span>
                  </motion.div>
                </Link>
              )
            })}
          </nav>

          <div className="mt-auto">
            <Button
              asChild
              className={cn(
                "w-full h-12 rounded-md shadow-lg",
                "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0"
              )}
            >
              <Link href="/login" onClick={() => setIsOpen(false)} className="flex items-center justify-center">
                <LogIn className="mr-2 h-5 w-5" />
                <span className={cn("text-xl tracking-wide pt-1", teko.className)}>
                  LOG IN
                </span>
              </Link>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
})

NavMobile.displayName = "NavMobile"
export { NavMobile }