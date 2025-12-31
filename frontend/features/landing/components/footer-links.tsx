"use client"

import { memo } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { FOOTER_LINKS } from "../constants"

const FooterLinks = memo(() => {
  return (
    <>
      {FOOTER_LINKS.map((section, sectionIndex) => (
        <motion.div
          key={section.title}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 + sectionIndex * 0.1 }}
        >
          <h3 className="font-semibold mb-4 text-foreground">{section.title}</h3>
          <ul className="space-y-3">
            {section.links.map((link, linkIndex) => (
              <motion.li
                key={link.name}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: 0.3 + sectionIndex * 0.1 + linkIndex * 0.05 }}
              >
                <Link
                  href={link.href}
                  className={cn(
                    "text-sm hover:underline underline-offset-4 flex items-center group w-fit",
                    "text-neutral-600 hover:text-gray-900",
                    "dark:text-neutral-400 dark:hover:text-white"
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
                    <ArrowUpRight size={12} className="text-blue-500 dark:text-blue-400" />
                  </motion.span>
                </Link>
              </motion.li>
            ))}
          </ul>
        </motion.div>
      ))}
    </>
  )
})

FooterLinks.displayName = "FooterLinks"
export { FooterLinks }