"use client"
import { useState, useEffect } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"
import { cn } from "@workspace/ui/lib/utils"
import { Github, Twitter, Linkedin, Mail, Heart, ArrowUpRight, Zap, BotIcon } from "lucide-react"

export const Footer = () => {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const currentYear = new Date().getFullYear()

  const footerLinks = [
    {
      title: "Product",
      links: [
        { name: "Features", href: "/features" },
        { name: "Pricing", href: "/pricing" },
        { name: "FAQs", href: "/faqs" },
        { name: "API", href: "/api" },
      ],
    },
    {
      title: "Company",
      links: [
        { name: "About", href: "/about" },
        { name: "Blog", href: "/blog" },
        { name: "Careers", href: "/careers" },
        { name: "Contact", href: "/contact" },
      ],
    },
    {
      title: "Legal",
      links: [
        { name: "Terms", href: "/terms" },
        { name: "Privacy", href: "/privacy" },
        { name: "Cookies", href: "/cookies" },
        { name: "Licenses", href: "/licenses" },
      ],
    },
  ]

  const socialLinks = [
    { name: "GitHub", icon: <Github size={18} />, href: "https://github.com" },
    { name: "Twitter", icon: <Twitter size={18} />, href: "https://twitter.com" },
    { name: "LinkedIn", icon: <Linkedin size={18} />, href: "https://linkedin.com" },
    { name: "Email", icon: <Mail size={18} />, href: "mailto:info@detectai.com" },
  ]

  return (
    <footer
      className={cn(
        "w-full relative overflow-hidden transition-colors duration-300 border-t",
        theme === "dark" ? "bg-black/90 border-white/10 text-white" : "bg-white/90 border-black/10 text-gray-900",
      )}
    >
      {/* Animated background elements */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div
          className={cn(
            "absolute inset-0 animate-gradient-slow",
            theme === "dark"
              ? "bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10"
              : "bg-gradient-to-r from-purple-300/20 via-blue-300/20 to-cyan-300/20",
          )}
        />
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
      </div>

      <div className="container mx-auto px-6 py-12 z-10 relative">
        {/* Main footer content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
          {/* Logo and company info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-2"
          >
            <Link href="/" className="flex items-center gap-2 mb-4">
              <motion.div whileHover={{ rotate: 10 }} transition={{ type: "spring", stiffness: 400, damping: 10 }}>
                <BotIcon className={cn("h-8 w-8", theme === "dark" ? "text-blue-400" : "text-blue-600")} />
              </motion.div>
              <span className="text-xl font-bold">Detect AI</span>
            </Link>
            <p className={cn("text-sm mb-6 max-w-md", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
              Detect AI helps you identify whether text is AI-generated or human-written with advanced machine learning
              models and high accuracy.
            </p>

            {/* Social links */}
            <div className="flex space-x-4 mb-6">
              {socialLinks.map((social, index) => (
                <motion.a
                  key={social.name}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 + index * 0.1 }}
                  whileHover={{ y: -3, scale: 1.1 }}
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    theme === "dark"
                      ? "bg-white/5 hover:bg-white/10 text-white"
                      : "bg-black/5 hover:bg-black/10 text-gray-900",
                  )}
                  aria-label={social.name}
                >
                  {social.icon}
                </motion.a>
              ))}
            </div>

            {/* Newsletter signup */}
            <div
              className={cn(
                "p-4 rounded-lg mb-6",
                theme === "dark" ? "bg-white/5 border border-white/10" : "bg-black/5 border border-black/10",
              )}
            >
              <h3 className="text-sm font-semibold mb-2">Stay updated</h3>
              <p className={cn("text-xs mb-3", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                Subscribe to our newsletter for the latest updates and features.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="Your email"
                  className={cn(
                    "text-sm px-3 py-2 rounded-md w-full",
                    theme === "dark"
                      ? "bg-black/40 border border-white/10 text-white placeholder:text-neutral-500"
                      : "bg-white border border-black/10 text-gray-900 placeholder:text-neutral-400",
                  )}
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    "px-3 py-2 rounded-md text-sm font-medium",
                    theme === "dark"
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-blue-500 hover:bg-blue-600 text-white",
                  )}
                >
                  Subscribe
                </motion.button>
              </div>
            </div>
          </motion.div>

          {/* Footer links */}
          {footerLinks.map((section, sectionIndex) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 + sectionIndex * 0.1 }}
            >
              <h3 className="font-semibold mb-4">{section.title}</h3>
              <ul className="space-y-3">
                {section.links.map((link, linkIndex) => (
                  <motion.li
                    key={link.name}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.3 + sectionIndex * 0.1 + linkIndex * 0.05 }}
                  >
                    <Link
                      href={link.href}
                      className={cn(
                        "text-sm hover:underline underline-offset-4 flex items-center group",
                        theme === "dark" ? "text-neutral-400 hover:text-white" : "text-neutral-600 hover:text-gray-900",
                      )}
                    >
                      {link.name}
                      <motion.span
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 0, x: -5 }}
                        whileHover={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2 }}
                        className="ml-1 inline-block"
                      >
                        <ArrowUpRight size={12} className="text-blue-400" />
                      </motion.span>
                    </Link>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Bottom bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className={cn(
            "flex flex-col sm:flex-row justify-between items-center mt-12 pt-6 border-t text-sm",
            theme === "dark" ? "border-white/10" : "border-black/10",
          )}
        >
          <div className="flex items-center mb-4 sm:mb-0">
            <p className={cn("text-xs", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
              &copy; {currentYear} Detect AI Inc. All rights reserved.
            </p>
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
              className="inline-flex mx-2"
            >
              <Heart size={12} className="text-red-500" />
            </motion.div>
          </div>
          <nav className="flex gap-6 flex-wrap justify-center">
            <Link
              href="/terms"
              className={cn(
                "text-xs hover:underline underline-offset-4",
                theme === "dark" ? "text-neutral-400 hover:text-white" : "text-neutral-600 hover:text-gray-900",
              )}
            >
              Terms of Service
            </Link>
            <Link
              href="/privacy"
              className={cn(
                "text-xs hover:underline underline-offset-4",
                theme === "dark" ? "text-neutral-400 hover:text-white" : "text-neutral-600 hover:text-gray-900",
              )}
            >
              Privacy Policy
            </Link>
            <Link
              href="/cookies"
              className={cn(
                "text-xs hover:underline underline-offset-4",
                theme === "dark" ? "text-neutral-400 hover:text-white" : "text-neutral-600 hover:text-gray-900",
              )}
            >
              Cookie Policy
            </Link>
          </nav>
        </motion.div>
      </div>
    </footer>
  )
}


