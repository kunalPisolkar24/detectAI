"use client"
import React, { useState, useEffect } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { useTheme } from "next-themes"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@workspace/ui/components/sheet"
import { PanelRight, X, Sun, Moon, BotIcon, FileText, Package, DollarSign, HelpCircle, LogIn} from "lucide-react"

// ModeToggle component
const ModeToggle = () => {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={cn(
        "p-2 rounded-full",
        theme === "dark" ? "bg-white/10 hover:bg-white/20 text-white" : "bg-black/5 hover:bg-black/10 text-black",
      )}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={theme}
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </motion.div>
      </AnimatePresence>
    </motion.button>
  )
}

// Logo component
const Logo = () => {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <Link href="/" className="flex items-center gap-2">
      <motion.div whileHover={{ rotate: 10 }} transition={{ type: "spring", stiffness: 400, damping: 10 }}>
        <BotIcon className={cn("h-8 w-8", theme === "dark" ? "text-blue-400" : "text-blue-600")} />
      </motion.div>
      <motion.span
        className="text-xl font-bold"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        Detect AI
      </motion.span>
    </Link>
  )
}

// NavItem component for consistent styling and animations
const NavItem = ({ href, icon, children, className, onClick = () => {} }: any) => {
  const { theme } = useTheme()
  const [isHovered, setIsHovered] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
    >
      <Link
        href={href}
        className={cn(
          "text-sm font-medium relative flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors",
          theme === "dark"
            ? "hover:bg-white/10 text-neutral-200 hover:text-white"
            : "hover:bg-black/5 text-neutral-700 hover:text-black",
          className,
        )}
        onClick={onClick}
      >
        {icon &&
          React.cloneElement(icon, {
            size: 16,
            className: cn("transition-colors", theme === "dark" ? "text-blue-400" : "text-blue-600"),
          })}
        {children}
        <motion.span
          className={cn(
            "absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full",
            theme === "dark" ? "opacity-80" : "opacity-70",
          )}
          initial={{ width: 0 }}
          animate={{ width: isHovered ? "100%" : 0 }}
          transition={{ duration: 0.3 }}
        />
      </Link>
    </motion.div>
  )
}

// NavItems component
const NavItems = ({ isMobile = false, onItemClick = () => {} }) => {
  const { theme } = useTheme()

  const navLinks = [
    { href: "/docs", label: "Docs", icon: <FileText /> },
    { href: "/features", label: "Features", icon: <Package /> },
    { href: "/pricing", label: "Pricing", icon: <DollarSign /> },
    { href: "/faqs", label: "FAQs", icon: <HelpCircle /> },
    { href: "/chat", label: "Detect AI", icon: <BotIcon /> },
  ]

  return (
    <>
      {navLinks.map((link, index) => (
        <NavItem
          key={link.href}
          href={link.href}
          icon={link.icon}
          onClick={onItemClick}
          className={isMobile ? "w-full" : ""}
        >
          {link.label}
        </NavItem>
      ))}

      {/* ModeToggle is visible from `md` and above, hidden on `sm` */}
      {!isMobile && (
        <div className="hidden md:block">
          <ModeToggle />
        </div>
      )}

      <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className={isMobile ? "w-full mt-2" : ""}>
        <Link href="/login" className="text-sm font-medium" onClick={onItemClick}>
          <Button
            className={cn(
              "flex items-center gap-1.5",
              theme === "dark"
                ? "bg-gradient-to-r from-blue-600/80 to-purple-600/80 hover:from-blue-600 hover:to-purple-600 text-white border-0"
                : "bg-gradient-to-r from-blue-500/80 to-purple-500/80 hover:from-blue-500 hover:to-purple-500 text-white border-0",
              isMobile ? "w-full justify-center" : "",
            )}
            variant="default"
          >
            <LogIn size={16} />
            Log in
          </Button>
        </Link>
      </motion.div>

      {/* ModeToggle for mobile */}
      {isMobile && (
        <div className="flex justify-center mt-4">
          <ModeToggle />
        </div>
      )}
    </>
  )
}

export const Navigation = () => {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  useEffect(() => {
    setMounted(true)

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }

    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  if (!mounted) return null

  return (
    <motion.div
      className={cn(
        "w-full fixed top-0 z-50 transition-all duration-300",
        isScrolled
          ? theme === "dark"
            ? "bg-black/80 backdrop-blur-md shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
            : "bg-white/80 backdrop-blur-md shadow-[0_2px_10px_rgba(0,0,0,0.1)]"
          : theme === "dark"
            ? "bg-transparent"
            : "bg-transparent",
      )}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <header className="container mx-auto flex items-center justify-between py-4 px-4 sm:px-6">
        <Logo />

        <motion.nav
          aria-label="Main navigation"
          className="hidden lg:flex items-center justify-center gap-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <NavItems />
        </motion.nav>

        {/* Mobile navigation */}
        <div className="lg:hidden">
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger asChild>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className={cn(
                  "p-2 rounded-full",
                  theme === "dark"
                    ? "bg-white/10 hover:bg-white/20 text-white"
                    : "bg-black/5 hover:bg-black/10 text-black",
                )}
                aria-label="Open navigation menu"
              >
                <AnimatePresence mode="wait">
                  {isSheetOpen ? (
                    <motion.div
                      key="close"
                      initial={{ rotate: -90, opacity: 0 }}
                      animate={{ rotate: 0, opacity: 1 }}
                      exit={{ rotate: 90, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <X className="h-5 w-5" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="menu"
                      initial={{ rotate: 90, opacity: 0 }}
                      animate={{ rotate: 0, opacity: 1 }}
                      exit={{ rotate: -90, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <PanelRight className="h-5 w-5" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            </SheetTrigger>
            <SheetContent
              className={cn(
                theme === "dark" ? "bg-black/95 border-white/10 text-white" : "bg-white border-black/10 text-black",
              )}
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <motion.div className="absolute inset-0 -z-10 opacity-10 pointer-events-none overflow-hidden">
                <motion.div
                  className={cn(
                    "absolute top-1/3 -left-32 w-64 h-64 rounded-full blur-3xl",
                    theme === "dark" ? "bg-purple-600/20" : "bg-purple-400/20",
                  )}
                  animate={{
                    x: [0, 30, 0],
                    y: [0, 15, 0],
                  }}
                  transition={{
                    duration: 15,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }}
                />
                <motion.div
                  className={cn(
                    "absolute bottom-1/3 -right-32 w-64 h-64 rounded-full blur-3xl",
                    theme === "dark" ? "bg-blue-600/20" : "bg-blue-400/20",
                  )}
                  animate={{
                    x: [0, -30, 0],
                    y: [0, -15, 0],
                  }}
                  transition={{
                    duration: 18,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }}
                />
              </motion.div>

              <div className="flex justify-center mb-8 mt-4">
                <Logo />
              </div>

              <nav aria-label="Mobile navigation" className="flex flex-col gap-3 mt-8">
                <NavItems isMobile={true} onItemClick={() => setIsSheetOpen(false)} />
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </header>
    </motion.div>
  )
}

