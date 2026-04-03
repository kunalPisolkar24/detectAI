"use client"

import { m } from "framer-motion"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { inter, teko } from "@/lib/fonts"
import { StreamingAnalysisProgress } from "../types"
import { getModelDisplayName } from "../utils/formatting"

interface AnalysisProgressCardProps {
  progress: StreamingAnalysisProgress
}

const formatProgress = (processedChunks: number, totalChunks: number) => {
  if (totalChunks <= 0) {
    return "Preparing analysis"
  }

  return `${processedChunks}/${totalChunks} chunks analyzed`
}

export const AnalysisProgressCard = ({ progress }: AnalysisProgressCardProps) => {
  const completion = progress.totalChunks > 0
    ? Math.min(100, Math.round((progress.processedChunks / progress.totalChunks) * 100))
    : 5

  return (
    <m.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn(
        "sm:ml-2 w-full max-w-[360px] overflow-hidden rounded-2xl border shadow-sm transition-all",
        "bg-white/80 border-neutral-200",
        "dark:bg-black/60 dark:border-white/10 dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]",
        "backdrop-blur-xl supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-black/40",
      )}
    >
      <div className="p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className={cn("text-[11px] font-bold uppercase tracking-widest opacity-60", inter.className)}>
              Analysis Model
            </span>
            <span className={cn("text-2xl sm:text-3xl font-medium leading-none tracking-wide", teko.className)}>
              {getModelDisplayName(progress.model)}
            </span>
          </div>

          <div className="px-2.5 py-1 rounded-lg border flex items-center gap-1.5 text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-500/10 dark:border-blue-400/20">
            <Loader2 size={12} className="animate-spin" />
            <span className={cn("text-sm font-medium tracking-wide pt-0.5 uppercase", teko.className)}>
              Analyzing
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className={cn("text-sm text-neutral-700 dark:text-neutral-200", inter.className)}>
              {formatProgress(progress.processedChunks, progress.totalChunks)}
            </span>
            <span className={cn("text-2xl leading-none tracking-wide text-blue-700 dark:text-blue-300", teko.className)}>
              {completion}%
            </span>
          </div>

          <div className="relative h-3 w-full rounded-full overflow-hidden bg-neutral-200/60 dark:bg-white/10 border border-black/5 dark:border-white/5">
            <m.div
              initial={{ width: "0%" }}
              animate={{ width: `${completion}%` }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-600"
            />
          </div>
        </div>
      </div>
    </m.div>
  )
}
