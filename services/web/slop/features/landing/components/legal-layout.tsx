"use client"

import type { ReactNode } from "react"
import { m } from "framer-motion"
import { ListOrdered, Mail } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { inter, merriweather, teko } from "@/lib/core/fonts"
import { contactMailto } from "../constants"

export interface LegalSection {
  id: string
  title: string
  content: ReactNode
}

interface LegalLayoutProps {
  updated: string
  sections: LegalSection[]
  contactTitle: string
  contactDescription: string
  contactSubject: string
}

export const LegalLayout = ({
  updated,
  sections,
  contactTitle,
  contactDescription,
  contactSubject,
}: LegalLayoutProps) => {
  return (
    <div className="w-full max-w-5xl flex flex-col items-center">
      <p className={cn("text-xs uppercase tracking-widest text-muted-foreground", inter.className)}>
        Last updated: {updated}
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
        <m.nav
          aria-label="Table of contents"
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="lg:sticky lg:top-28 lg:self-start"
        >
          <div
            className={cn(
              "rounded-xl border p-4 backdrop-blur-sm",
              "bg-white/60 border-black/10",
              "dark:bg-black/40 dark:border-white/10"
            )}
          >
            <p className={cn("flex items-center gap-2 text-sm font-semibold", inter.className)}>
              <ListOrdered size={14} className="text-blue-600 dark:text-blue-400" />
              On this page
            </p>
            <ol className="mt-3 space-y-2">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="group flex items-baseline gap-2 text-sm text-neutral-600 transition-colors hover:text-blue-600 dark:text-neutral-400 dark:hover:text-blue-400"
                  >
                    <span className="text-xs tabular-nums opacity-50">{index + 1}.</span>
                    <span className="leading-snug group-hover:underline group-hover:underline-offset-4">
                      {section.title}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </m.nav>

        <div className="flex min-w-0 flex-col gap-8">
          {sections.map((section, index) => (
            <m.section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: Math.min(index * 0.05, 0.3) }}
              className={cn(
                "scroll-mt-28 rounded-xl border p-6 sm:p-8 backdrop-blur-sm",
                "bg-white/70 border-black/10",
                "dark:bg-black/40 dark:border-white/10"
              )}
            >
              <h2
                id={`${section.id}-heading`}
                className={cn("flex items-baseline gap-3 text-2xl tracking-wide", teko.className)}
              >
                <span aria-hidden="true" className="text-base tabular-nums text-blue-600 dark:text-blue-400">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {section.title}
              </h2>
              <div
                className={cn(
                  "mt-4 space-y-4 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-300",
                  "[&_ul]:space-y-3 [&_li]:relative [&_li]:pl-5",
                  merriweather.className
                )}
              >
                {section.content}
              </div>
            </m.section>
          ))}
        </div>
      </div>

      <m.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className={cn(
          "mt-12 flex w-full max-w-3xl flex-col items-center gap-4 rounded-xl border p-6 text-center backdrop-blur-sm sm:flex-row sm:text-left",
          "bg-white/60 border-black/10",
          "dark:bg-black/40 dark:border-white/10"
        )}
      >
        <span className="shrink-0 rounded-xl border border-blue-500/20 bg-blue-500/10 p-2.5 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-300">
          <Mail size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={cn("text-2xl tracking-wide", teko.className)}>{contactTitle}</h2>
          <p className={cn("mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300", inter.className)}>
            {contactDescription}
          </p>
        </div>
        <a
          href={contactMailto(contactSubject)}
          className={cn(
            "shrink-0 rounded-md px-6 py-2 text-2xl transition-all duration-200",
            "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-500/20",
            teko.className
          )}
        >
          Contact us
        </a>
      </m.div>
    </div>
  )
}
