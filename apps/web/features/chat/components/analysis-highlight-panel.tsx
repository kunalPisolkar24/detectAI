"use client"

import { useState } from "react"
import { m } from "framer-motion"
import { Bot, ChevronDown, Fingerprint, Highlighter } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { inter, merriweather, teko } from "@/lib/fonts"
import { AnalysisHighlightSpan } from "../types"
import { buildHighlightedTextSegments } from "../utils/highlighted-text"
import { formatPercentage } from "../utils/formatting"

interface AnalysisHighlightPanelProps {
  sourceText: string
  highlights: AnalysisHighlightSpan[]
}

const COLLAPSE_THRESHOLD = 600

export const AnalysisHighlightPanel = ({
  sourceText,
  highlights,
}: AnalysisHighlightPanelProps) => {
  const canCollapse = sourceText.length > COLLAPSE_THRESHOLD
  const [isExpanded, setIsExpanded] = useState(!canCollapse)
  const segments = buildHighlightedTextSegments(sourceText, highlights)

  if (!sourceText || highlights.length === 0 || segments.length === 0) {
    return null
  }

  return (
    <m.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn(
        "sm:ml-2 w-full overflow-hidden rounded-2xl border shadow-sm transition-all",
        "bg-white/80 border-neutral-200",
        "dark:bg-black/60 dark:border-white/10 dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]",
        "backdrop-blur-xl supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-black/40",
      )}
    >
      <div className="p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-2 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/20 dark:text-purple-300">
              <Highlighter size={16} />
            </div>

            <div className="flex flex-col gap-0.5">
              <span className={cn("text-[11px] font-bold uppercase tracking-widest opacity-60", inter.className)}>
                Highlighted Result
              </span>
              <span className={cn("text-2xl sm:text-3xl font-medium leading-none tracking-wide", teko.className)}>
                Chunk-Level View
              </span>
              <p className={cn("text-sm text-neutral-600 dark:text-neutral-300", inter.className)}>
                Highlighted passages are based on the final chunk-level confidence map.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/20 bg-purple-500/10 px-2.5 py-1 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/20 dark:text-purple-300">
              <Bot size={12} strokeWidth={2.5} />
              <span className={cn("text-sm font-medium tracking-wide pt-0.5 uppercase", teko.className)}>
                AI-Likely
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
              <Fingerprint size={12} strokeWidth={2.5} />
              <span className={cn("text-sm font-medium tracking-wide pt-0.5 uppercase", teko.className)}>
                Human-Likely
              </span>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "relative rounded-xl border border-black/5 bg-neutral-50/80 p-4 dark:border-white/10 dark:bg-white/5",
            !isExpanded && canCollapse && "max-h-64 overflow-hidden",
          )}
        >
          <div className={cn("text-[15px] leading-7 whitespace-pre-wrap break-words text-neutral-800 dark:text-neutral-100", merriweather.className)}>
            {segments.map((segment, index) => {
              if (segment.tone === "plain") {
                return <span key={index}>{segment.text}</span>
              }

              const isAI = segment.tone === "AI"

              return (
                <span
                  key={index}
                  title={`AI confidence ${formatPercentage(segment.aiConfidence ?? 0)}`}
                  className={cn(
                    "rounded-[0.55rem] border px-1 py-0.5 transition-colors",
                    isAI
                      ? "border-purple-500/20 bg-purple-500/10 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/20 dark:text-purple-300"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
                  )}
                >
                  {segment.text}
                </span>
              )
            })}
          </div>

          {!isExpanded && canCollapse ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white via-white/95 to-transparent dark:from-black dark:via-black/95" />
          ) : null}
        </div>

        {canCollapse ? (
          <div className="flex justify-start">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded((current) => !current)}
              className={cn(
                "group gap-2 rounded-lg px-2 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white",
                teko.className,
              )}
            >
              <ChevronDown
                size={14}
                className={cn("transition-transform duration-200", isExpanded && "rotate-180")}
              />
              <span className="pt-0.5 text-base tracking-wide">
                {isExpanded ? "COLLAPSE" : "EXPAND FULL TEXT"}
              </span>
            </Button>
          </div>
        ) : null}
      </div>
    </m.div>
  )
}
