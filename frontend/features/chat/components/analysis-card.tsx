"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/utils"
import { AnalysisResult } from "../types"
import { Fingerprint, Bot } from "lucide-react"
import { teko, inter } from "@/lib/fonts"

interface AnalysisCardProps {
  result: AnalysisResult
}

export const AnalysisCard = ({ result }: AnalysisCardProps) => {
  const isAI = result.label === "AI"
  const humanScore = Math.round(result.scores.human * 100)
  const aiScore = Math.round(result.scores.ai * 100)
  
  const statusColor = isAI 
    ? "text-purple-300 bg-purple-500/20 border-purple-500/20" 
    : "text-emerald-300 bg-emerald-500/20 border-emerald-500/20"

  const modelName = result.model === "spark" ? "Spark" : "Flare"
  const statusText = isAI ? "AI-GENERATED" : "HUMAN-WRITTEN"

  return (
    <m.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn(
        "w-full max-w-lg overflow-hidden rounded-3xl border shadow-sm transition-all",
        "bg-white/80 border-neutral-200",
        "dark:bg-black/60 dark:border-white/10 dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]",
        "backdrop-blur-xl supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-black/40"
      )}
    >
      <div className="p-5 sm:p-6 flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className={cn("text-[10px] sm:text-xs font-bold uppercase tracking-widest opacity-50", inter.className)}>
              Analysis Model
            </span>
            <span className={cn("text-2xl sm:text-3xl font-medium leading-none tracking-wide", teko.className)}>
              {modelName}
            </span>
          </div>

          <div className={cn(
            "px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border flex items-center gap-2",
            statusColor
          )}>
            <div className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full animate-pulse", isAI ? "bg-purple-400" : "bg-emerald-400")} />
            <span className={cn("text-base sm:text-lg font-medium tracking-wide pt-0.5 uppercase", teko.className)}>
              {statusText}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-end px-0.5">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <Fingerprint size={12} strokeWidth={2.5} />
                <span className={cn("text-[10px] sm:text-xs font-bold uppercase tracking-wider", inter.className)}>
                  Human
                </span>
              </div>
              <span className={cn("text-3xl sm:text-4xl font-bold leading-none tracking-tight", teko.className)}>
                {humanScore}%
              </span>
            </div>
            
            <div className="flex flex-col gap-0.5 items-end">
              <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                <span className={cn("text-[10px] sm:text-xs font-bold uppercase tracking-wider", inter.className)}>
                  AI
                </span>
                <Bot size={12} strokeWidth={2.5} />
              </div>
              <span className={cn("text-3xl sm:text-4xl font-bold leading-none tracking-tight", teko.className)}>
                {aiScore}%
              </span>
            </div>
          </div>

          <div className="relative h-3 sm:h-4 w-full rounded-full overflow-hidden bg-neutral-200/50 dark:bg-white/5 flex p-0.5 border border-black/5 dark:border-white/5">
            <m.div 
              initial={{ width: "50%" }}
              animate={{ width: `${humanScore}%` }}
              transition={{ duration: 1, ease: "circOut" }}
              className="h-full rounded-l-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
            />
            
            <div className="w-0.5 h-full bg-transparent" />

            <m.div 
              initial={{ width: "50%" }}
              animate={{ width: `${aiScore}%` }}
              transition={{ duration: 1, ease: "circOut" }}
              className="h-full rounded-r-full bg-purple-600 shadow-[0_0_15px_rgba(147,51,234,0.4)]"
            />
          </div>
          
          <div className="flex justify-between px-1 opacity-20 text-[8px] sm:text-[10px]">
            <span className="h-2 w-px bg-current block" />
            <span className="h-2 w-px bg-current block" />
            <span className="h-2 w-px bg-current block" />
          </div>
        </div>
      </div>
    </m.div>
  )
}