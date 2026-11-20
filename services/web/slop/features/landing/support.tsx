"use client"

import { m } from "framer-motion"
import { ArrowUpRight, BookOpen, CreditCard, Gauge, LifeBuoy, ListChecks } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { teko } from "@/lib/core/fonts"
import { PageHero } from "./components/page-hero"
import { contactMailto } from "./constants"

const SUPPORT_TOPICS = [
  {
    id: "getting-started",
    icon: BookOpen,
    title: "Getting started",
    description: "Accounts, signing in, running your first detection, and understanding results.",
    subject: "Getting started question",
  },
  {
    id: "billing",
    icon: CreditCard,
    title: "Billing & Premium",
    description: "Plans, upgrades, cancellations, and anything about Flare access.",
    subject: "Billing question",
  },
  {
    id: "results",
    icon: Gauge,
    title: "Detection questions",
    description: "A result looks off, scores are confusing, or highlights seem wrong.",
    subject: "Question about my results",
  },
]

const BEFORE_YOU_WRITE = [
  "The email address on your account",
  "Your plan (Spark or Flare) and the model you used",
  "What you expected vs. what you saw",
  "Never include passwords — we will never ask for them",
]

export const Support = () => {
  return (
    <section className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-transparent text-foreground transition-colors duration-300 py-16 md:py-24">
      <div className="w-full container px-6 sm:px-8 lg:mx-auto flex flex-col items-center justify-center space-y-12 md:space-y-16 z-10">
        <PageHero
          badge="Support"
          icon={LifeBuoy}
          title="How can we help?"
          description="Pick a topic below to email us with the right context attached. Every message is read by a real person on the Detect AI team."
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-5xl place-items-stretch">
          {SUPPORT_TOPICS.map((topic, index) => (
            <m.div
              key={topic.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              className={cn(
                "flex flex-col rounded-xl border p-6 backdrop-blur-sm transition-all duration-300",
                "bg-white/70 border-black/10 hover:shadow-[0_20px_40px_-15px_rgba(0,0,200,0.2)]",
                "dark:bg-black/40 dark:border-white/10 dark:hover:shadow-[0_20px_40px_-15px_rgba(0,0,255,0.3)]"
              )}
            >
              <span className="inline-block w-fit rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-300">
                <topic.icon size={20} />
              </span>
              <h2 className="mt-4 text-xl font-semibold">{topic.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                {topic.description}
              </p>
              <a
                href={contactMailto(topic.subject)}
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Email support
                <ArrowUpRight size={14} />
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
            "w-full max-w-3xl rounded-xl border p-6 sm:p-8 backdrop-blur-sm",
            "bg-white/60 border-black/10",
            "dark:bg-black/40 dark:border-white/10"
          )}
        >
          <div className="flex items-center gap-3">
            <span className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">
              <ListChecks size={18} />
            </span>
            <h2 className={cn("text-2xl sm:text-3xl tracking-wide", teko.className)}>
              Before you write in
            </h2>
          </div>
          <ul className="mt-5 space-y-3">
            {BEFORE_YOU_WRITE.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                {item}
              </li>
            ))}
          </ul>
        </m.div>
      </div>
    </section>
  )
}
