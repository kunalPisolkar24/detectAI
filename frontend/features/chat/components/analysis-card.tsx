"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/utils"
import { AnalysisResult } from "../types"
import { Fingerprint, Bot } from "lucide-react"
import { teko, inter } from "@/lib/fonts"
import { formatPercentage, getAnalysisConfig, getModelDisplayName } from "../utils/formatting"

interface AnalysisCardProps {
  result: AnalysisResult
}

export const AnalysisCard = ({ result }: AnalysisCardProps) => {
  const isAI = result.label === "AI"
  const config = getAnalysisConfig(isAI)
  
  const humanScoreDisplay = formatPercentage(result.scores.human)
  const aiScoreDisplay = formatPercentage(result.scores.ai)
  const humanScoreValue = Math.round(result.scores.human * 100)
  const aiScoreValue = Math.round(result.scores.ai * 100)
  
  return (
    <m.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn(
        "sm:ml-2 w-full max-w-[380px] overflow-hidden rounded-2xl border shadow-sm transition-all",
        "bg-white/80 border-neutral-200",
        "dark:bg-black/60 dark:border-white/10 dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]",
        "backdrop-blur-xl supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-black/40"
      )}
    >
      <div className="p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className={cn("text-[11px] font-bold uppercase tracking-widest opacity-60", inter.className)}>
              Analysis Model
            </span>
            <span className={cn("text-2xl sm:text-3xl font-medium leading-none tracking-wide", teko.className)}>
              {getModelDisplayName(result.model)}
            </span>
          </div>

          <div className={cn(
            "px-2.5 py-1 rounded-lg border flex items-center gap-1.5",
            config.colors.text,
            config.colors.bg,
            config.colors.border
          )}>
            <div className={cn("w-2 h-2 rounded-full animate-pulse", config.colors.dot)} />
            <span className={cn("text-sm font-medium tracking-wide pt-0.5 uppercase", teko.className)}>
              {config.label}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-end px-0.5">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <Fingerprint size={12} strokeWidth={2.5} aria-hidden="true" />
                <span className={cn("text-[10px] sm:text-[11px] font-bold uppercase tracking-wider", inter.className)}>
                  Human
                </span>
              </div>
              <span className={cn("text-3xl sm:text-4xl font-bold leading-none tracking-tight", teko.className)}>
                {humanScoreDisplay}
              </span>
            </div>
            
            <div className="flex flex-col gap-1 items-end">
              <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                <span className={cn("text-[10px] sm:text-[11px] font-bold uppercase tracking-wider", inter.className)}>
                  AI
                </span>
                <Bot size={12} strokeWidth={2.5} aria-hidden="true" />
              </div>
              <span className={cn("text-3xl sm:text-4xl font-bold leading-none tracking-tight", teko.className)}>
                {aiScoreDisplay}
              </span>
            </div>
          </div>

          <div 
            className="relative h-3 w-full rounded-full overflow-hidden bg-neutral-200/50 dark:bg-white/5 flex p-[1px] border border-black/5 dark:border-white/5"
            role="progressbar"
            aria-valuenow={aiScoreValue}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="AI Likelihood"
          >
            <m.div 
              initial={{ width: "50%" }}
              animate={{ width: `${humanScoreValue}%` }}
              transition={{ duration: 1, ease: "circOut" }}
              className="h-full rounded-l-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
            />
            
            <div className="w-[1px] h-full bg-transparent" />

            <m.div 
              initial={{ width: "50%" }}
              animate={{ width: `${aiScoreValue}%` }}
              transition={{ duration: 1, ease: "circOut" }}
              className="h-full rounded-r-full bg-purple-600 shadow-[0_0_10px_rgba(147,51,234,0.4)]"
            />
          </div>
          
          <div className="flex justify-between px-1 opacity-30 text-[8px]" aria-hidden="true">
            <span className="h-1.5 w-px bg-current block" />
            <span className="h-1.5 w-px bg-current block" />
            <span className="h-1.5 w-px bg-current block" />
          </div>
        </div>
      </div>
    </m.div>
  )
}