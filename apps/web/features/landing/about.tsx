"use client"

import Link from "next/link"
import { m } from "framer-motion"
import { BotIcon, Flame, Gauge, Highlighter, ShieldCheck, Zap } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { inter, merriweather, teko } from "@/lib/core/fonts"
import { PageHero } from "./components/page-hero"

const MODEL_CARDS = [
  {
    id: "spark",
    name: "Spark",
    tagline: "Fast everyday checks",
    description: "Quick, reliable detection for everyday content — free with 100 scans a day.",
    icon: Zap,
    iconClasses: "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    cta: { label: "Try Spark free", href: "/signup" },
    featured: false,
  },
  {
    id: "flare",
    name: "Flare",
    tagline: "Deep multi-layer detection",
    description: "Advanced analysis with unlimited scans for professionals and heavy users.",
    icon: Flame,
    iconClasses: "bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
    cta: { label: "Go Flare", href: "/upgrade" },
    featured: true,
  },
]

const CAPABILITIES = [
  {
    icon: Highlighter,
    title: "Chunk-level highlights",
    description: "See exactly which passages read as AI-generated, backed by per-span confidence.",
  },
  {
    icon: Gauge,
    title: "AI vs human scores",
    description: "A clear verdict with calibrated confidence — not just a black-box label.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy-first",
    description: "Submitted text is never stored or shared. Your words stay yours.",
  },
]

export const About = () => {
  return (
    <section className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-transparent text-foreground transition-colors duration-300 py-16 md:py-24">
      <div className="w-full container px-6 sm:px-8 lg:mx-auto flex flex-col items-center justify-center space-y-12 md:space-y-16 z-10">
        <PageHero
          badge="About Detect AI"
          icon={BotIcon}
          title="Human or AI? Now you know."
          description="Detect AI analyzes writing patterns, structure, and linguistic signals to tell AI-generated text apart from human writing — in seconds."
        />

        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className={cn(
            "w-full max-w-3xl rounded-xl border p-6 sm:p-8 backdrop-blur-sm",
            "bg-white/70 border-black/10",
            "dark:bg-black/40 dark:border-white/10"
          )}
        >
          <h2 className={cn("text-2xl sm:text-3xl tracking-wide", teko.className)}>
            Why Detect AI exists
          </h2>
          <div className={cn("mt-4 space-y-4 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-300", merriweather.className)}>
            <p>
              AI-generated text is everywhere — in classrooms, newsrooms, hiring pipelines, and
              publishing queues. Knowing what you&apos;re reading matters, but spotting machine
              writing by eye is getting harder every month.
            </p>
            <p>
              Detect AI exists to give that clarity back. Paste any text and our models break it
              down chunk by chunk, highlight the passages that read as artificial, and score the
              result — so you can judge with evidence instead of gut feel.
            </p>
          </div>
        </m.div>

        <div className="w-full max-w-5xl">
          <m.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className={cn("text-center text-2xl sm:text-3xl tracking-wide", teko.className)}
          >
            Two models, one job
          </m.h2>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6 lg:gap-8 place-items-stretch mx-auto">
            {MODEL_CARDS.map((model, index) => (
              <m.div
                key={model.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.15 }}
                className={cn(
                  "relative flex flex-col rounded-xl border p-6 backdrop-blur-sm transition-all duration-300",
                  "bg-white/70 border-black/10 hover:shadow-[0_20px_40px_-15px_rgba(0,0,200,0.2)]",
                  "dark:bg-black/40 dark:border-white/10 dark:hover:shadow-[0_20px_40px_-15px_rgba(0,0,255,0.3)]",
                  model.featured && "border-blue-500/50 dark:border-blue-500/50 bg-white/80 dark:bg-black/50"
                )}
              >
                <div className="flex items-center gap-3">
                  <span className={cn("rounded-xl p-2", model.iconClasses)}>
                    <model.icon size={20} />
                  </span>
                  <div>
                    <h3 className="text-2xl font-semibold leading-none">{model.name}</h3>
                    <p className={cn("mt-1 text-xs uppercase tracking-widest opacity-60", inter.className)}>
                      {model.tagline}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {model.description}
                </p>
                <Link
                  href={model.cta.href}
                  className={cn(
                    "mt-6 inline-block w-full rounded-md px-5 py-2 text-center text-2xl transition-all duration-200",
                    teko.className,
                    model.featured
                      ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0 shadow-lg shadow-blue-500/20"
                      : "bg-transparent border border-black/20 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                  )}
                >
                  {model.cta.label}
                </Link>
                {model.featured && (
                  <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-b-xl" />
                )}
              </m.div>
            ))}
          </div>
        </div>

        <div className="w-full max-w-5xl">
          <m.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className={cn("text-center text-2xl sm:text-3xl tracking-wide", teko.className)}
          >
            Built for evidence, not vibes
          </m.h2>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
            {CAPABILITIES.map((capability, index) => (
              <m.div
                key={capability.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.12 }}
                className={cn(
                  "rounded-xl border p-6 backdrop-blur-sm",
                  "bg-white/60 border-black/10",
                  "dark:bg-black/40 dark:border-white/10"
                )}
              >
                <span className="inline-block rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-300">
                  <capability.icon size={18} />
                </span>
                <h3 className="mt-4 font-semibold">{capability.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {capability.description}
                </p>
              </m.div>
            ))}
          </div>
        </div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className={cn(
            "text-center p-6 sm:p-8 rounded-xl w-full max-w-2xl mx-auto",
            "bg-white/60 border border-black/10 backdrop-blur-sm",
            "dark:bg-black/40 dark:border-white/10"
          )}
        >
          <h3 className={cn("text-2xl sm:text-3xl tracking-wide", teko.className)}>
            Ready to check your text?
          </h3>
          <p className="mt-2 text-sm sm:text-base text-neutral-600 dark:text-neutral-300">
            Create a free account and run your first detection in seconds.
          </p>
          <Link
            href="/signup"
            className={cn(
              "inline-block mt-5 px-8 py-2 rounded-md font-medium text-2xl transition-all duration-200",
              "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-500/20",
              teko.className
            )}
          >
            Get started
          </Link>
        </m.div>
      </div>
    </section>
  )
}
