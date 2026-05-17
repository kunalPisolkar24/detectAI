"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/core/utils"
import { teko, inter } from "@/lib/core/fonts"
import { Infinity } from "lucide-react"

interface UsageStatsProps {
  dailyCount: number
  totalCount: number
  isPremium: boolean
}

export const UsageStats = ({ dailyCount, totalCount, isPremium }: UsageStatsProps) => {
  const dailyPercentage = isPremium ? 0 : Math.min((dailyCount / 100) * 100, 100)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h4 className={cn("text-sm font-medium text-muted-foreground", inter.className)}>
              Daily API Usage
            </h4>
            <div className="flex items-baseline gap-1">
              <span className={cn("text-2xl font-bold", teko.className)}>
                {dailyCount}
              </span>
              <span className="text-sm text-muted-foreground">/</span>
              {isPremium ? (
                <Infinity size={18} className="text-purple-500 translate-y-1" />
              ) : (
                <span className={cn("text-lg font-medium", teko.className)}>100</span>
              )}
            </div>
          </div>
          <div className={cn(
            "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
            isPremium 
              ? "bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400" 
              : "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400"
          )}>
            {isPremium ? "Unlimited" : "Standard"}
          </div>
        </div>
        
        {!isPremium && (
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
            <m.div
              initial={{ width: 0 }}
              animate={{ width: `${dailyPercentage}%` }}
              transition={{ duration: 1, ease: "circOut" }}
              className={cn(
                "h-full rounded-full transition-all",
                dailyPercentage > 90 ? "bg-red-500" : "bg-blue-600 dark:bg-blue-500"
              )}
            />
          </div>
        )}
      </div>

      <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
        <h4 className={cn("text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2", inter.className)}>
          Lifetime Analysis
        </h4>
        <div className="flex items-center gap-2">
          <span className={cn("text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-muted-foreground", teko.className)}>
            {totalCount.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground pb-1">total scans performed</span>
        </div>
      </div>
    </div>
  )
}