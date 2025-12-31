"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { BotIcon, Heart } from "lucide-react"
import { cn } from "@/lib/utils"
import { FooterNewsletter } from "./components/footer-newsletter"
import { FooterSocials } from "./components/footer-socials"
import { FooterLinks } from "./components/footer-links"

export const Footer = () => {
  const currentYear = new Date().getFullYear()

  return (
    <footer className={cn(
      "w-full relative overflow-hidden transition-colors duration-300 border-t",
      "bg-white/90 border-black/10 text-gray-900",
      "dark:bg-black/90 dark:border-white/10 dark:text-white"
    )}>
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div className={cn(
          "absolute inset-0 animate-gradient-slow",
          "bg-gradient-to-r from-purple-300/20 via-blue-300/20 to-cyan-300/20",
          "dark:from-purple-500/10 dark:via-blue-500/10 dark:to-cyan-500/10"
        )} />
        <motion.div
          className="absolute top-1/3 -left-32 w-64 h-64 rounded-full blur-3xl bg-purple-400/20 dark:bg-purple-600/20"
          animate={{ x: [0, 30, 0], y: [0, 15, 0] }}
          transition={{ duration: 15, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-1/3 -right-32 w-64 h-64 rounded-full blur-3xl bg-blue-400/20 dark:bg-blue-600/20"
          animate={{ x: [0, -30, 0], y: [0, -15, 0] }}
          transition={{ duration: 18, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
      </div>

      <div className="container mx-auto px-6 py-12 z-10 relative">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-2"
          >
            <Link href="/" className="flex items-center gap-2 mb-4 w-fit">
              <motion.div whileHover={{ rotate: 10 }} transition={{ type: "spring", stiffness: 400, damping: 10 }}>
                <BotIcon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </motion.div>
              <span className="text-xl font-bold">Detect AI</span>
            </Link>
            <p className="text-sm mb-6 max-w-md text-neutral-600 dark:text-neutral-400">
              Detect AI helps you identify whether text is AI-generated or human-written with advanced machine learning models and high accuracy.
            </p>

            <FooterSocials />
            <FooterNewsletter />
          </motion.div>

          <FooterLinks />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="flex flex-col sm:flex-row justify-between items-center mt-12 pt-6 border-t text-sm border-black/10 dark:border-white/10"
        >
          <div className="flex items-center mb-4 sm:mb-0">
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
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
              className="text-xs hover:underline underline-offset-4 text-neutral-600 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-white"
            >
              Terms of Service
            </Link>
            <Link
              href="/privacy"
              className="text-xs hover:underline underline-offset-4 text-neutral-600 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-white"
            >
              Privacy Policy
            </Link>
          </nav>
        </motion.div>
      </div>
    </footer>
  )
}