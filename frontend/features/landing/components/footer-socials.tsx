"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/utils"
import { SOCIAL_LINKS } from "../constants"

export const FooterSocials = () => {
  return (
    <div className="flex space-x-4 mb-6">
      {SOCIAL_LINKS.map((social, index) => {
        const Icon = social.icon
        return (
          <m.a
            key={social.name}
            href={social.href}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.1 + index * 0.1 }}
            whileHover={{ y: -3, scale: 1.1 }}
            className={cn(
              "p-2 rounded-full transition-colors",
              "bg-black/5 hover:bg-black/10 text-gray-900",
              "dark:bg-white/5 dark:hover:bg-white/10 dark:text-white"
            )}
            aria-label={social.name}
          >
            <Icon size={18} />
          </m.a>
        )
      })}
    </div>
  )
}