"use client"

import Link from "next/link"
import { m } from "framer-motion"
import { ArrowRight, LifeBuoy, Mail, MessageSquare } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { inter, teko } from "@/lib/core/fonts"
import { PageHero } from "./components/page-hero"
import { CONTACT_EMAIL, SOCIAL_LINKS, contactMailto } from "./constants"

const CONTACT_CARDS = [
  {
    id: "general",
    icon: Mail,
    title: "General contact",
    description: "Questions, feedback, partnerships, or just saying hello.",
    emailLabel: CONTACT_EMAIL,
    href: contactMailto(),
    cta: "Email us",
  },
  {
    id: "support",
    icon: LifeBuoy,
    title: "Support",
    description: "Trouble signing in, billing questions, or results that look off.",
    emailLabel: CONTACT_EMAIL,
    href: contactMailto("Support request"),
    cta: "Get support",
  },
]

export const Contact = () => {
  return (
    <section className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-transparent text-foreground transition-colors duration-300 py-16 md:py-24">
      <div className="w-full container px-6 sm:px-8 lg:mx-auto flex flex-col items-center justify-center space-y-12 md:space-y-16 z-10">
        <PageHero
          badge="Contact"
          icon={MessageSquare}
          title="Talk to a human."
          description="No bots, no ticket black holes. Write to us directly and a real person from the Detect AI team will get back to you."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 lg:gap-8 w-full max-w-4xl place-items-stretch">
          {CONTACT_CARDS.map((card, index) => (
            <m.div
              key={card.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              className={cn(
                "relative flex flex-col rounded-xl border p-6 backdrop-blur-sm transition-all duration-300",
                "bg-white/70 border-black/10 hover:shadow-[0_20px_40px_-15px_rgba(0,0,200,0.2)]",
                "dark:bg-black/40 dark:border-white/10 dark:hover:shadow-[0_20px_40px_-15px_rgba(0,0,255,0.3)]"
              )}
            >
              <span className="inline-block w-fit rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-300">
                <card.icon size={20} />
              </span>
              <h2 className="mt-4 text-2xl font-semibold">{card.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                {card.description}
              </p>
              <p className={cn("mt-4 text-sm font-medium text-blue-600 dark:text-blue-400 break-all", inter.className)}>
                {card.emailLabel}
              </p>
              <a
                href={card.href}
                className={cn(
                  "mt-6 inline-block w-full rounded-md px-5 py-2 text-center text-2xl transition-all duration-200",
                  "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0 shadow-lg shadow-blue-500/20",
                  teko.className
                )}
              >
                {card.cta}
              </a>
            </m.div>
          ))}
        </div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className={cn(
            "w-full max-w-4xl rounded-xl border p-6 sm:p-8 backdrop-blur-sm text-center",
            "bg-white/60 border-black/10",
            "dark:bg-black/40 dark:border-white/10"
          )}
        >
          <h2 className={cn("text-2xl sm:text-3xl tracking-wide", teko.className)}>
            Prefer to browse first?
          </h2>
          <p className="mt-2 text-sm sm:text-base text-neutral-600 dark:text-neutral-300">
            Most questions about accuracy, plans, and privacy already have answers.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/support"
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-6 py-2 text-2xl transition-all duration-200",
                "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-500/20",
                teko.className
              )}
            >
              Visit support
              <ArrowRight size={18} />
            </Link>
            <div className="flex items-center gap-2">
              {SOCIAL_LINKS.map((social) => (
                <a
                  key={social.name}
                  href={social.href}
                  target={social.href.startsWith("http") ? "_blank" : undefined}
                  rel={social.href.startsWith("http") ? "noreferrer" : undefined}
                  aria-label={social.name}
                  className={cn(
                    "rounded-lg border border-black/10 p-2.5 text-neutral-600 transition-colors hover:bg-black/5 hover:text-foreground",
                    "dark:border-white/10 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
                  )}
                >
                  <social.icon size={16} />
                </a>
              ))}
            </div>
          </div>
        </m.div>
      </div>
    </section>
  )
}
