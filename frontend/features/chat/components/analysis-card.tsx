"use client"
import { m } from "framer-motion"
import { cn } from "@/lib/utils"
import { AnalysisResult } from "../types"
import { Sparkles, Zap, ChevronDown } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

interface AnalysisCardProps {
  result: AnalysisResult
}

export const AnalysisCard = ({ result }: AnalysisCardProps) => {
  const isAI = result.label === "AI"
  const percentage = Math.round(result.confidence * 100)

  const themeColor = isAI ? "text-red-500" : "text-green-500"
  const bgColor = isAI ? "bg-red-500" : "bg-green-500"
  const bgSoft = isAI ? "bg-red-500/10" : "bg-green-500/10"
  const borderColor = isAI ? "border-red-500/20" : "border-green-500/20"

  const Icon = result.model === "spark" ? Zap : Sparkles

  return (
    <m.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn(
        "w-full max-w-xl overflow-hidden rounded-xl border bg-card/50 backdrop-blur-sm",
        borderColor
      )}
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-md", bgSoft)}>
              <Icon size={16} className={themeColor} />
            </div>
            <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {result.model} Analysis
            </span>
          </div>
          <div className={cn("px-3 py-1 rounded-full text-xs font-bold border", bgSoft, themeColor, borderColor)}>
            {isAI ? "LIKELY AI-GENERATED" : "LIKELY HUMAN-WRITTEN"}
          </div>
        </div>

        <div className="mb-6">
          {result.model === "spark" ? (
             <div className="relative pt-1">
               <div className="flex mb-2 items-center justify-between">
                 <div>
                   <span className={cn("text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full", themeColor, bgSoft)}>
                     Confidence
                   </span>
                 </div>
                 <div className="text-right">
                   <span className={cn("text-xs font-semibold inline-block", themeColor)}>
                     {percentage}%
                   </span>
                 </div>
               </div>
               <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-secondary">
                 <m.div
                   initial={{ width: 0 }}
                   animate={{ width: `${percentage}%` }}
                   transition={{ duration: 1, ease: "easeOut" }}
                   className={cn("shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center", bgColor)}
                 />
               </div>
             </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-muted-foreground">
                <span>Human</span>
                <span>AI</span>
              </div>
              <div className="relative h-4 w-full rounded-full overflow-hidden bg-secondary flex">
                <m.div 
                  initial={{ width: "50%" }}
                  animate={{ width: `${result.scores.human * 100}%` }}
                  transition={{ duration: 0.8, ease: "circOut" }}
                  className="h-full bg-green-500"
                />
                <m.div 
                  initial={{ width: "50%" }}
                  animate={{ width: `${result.scores.ai * 100}%` }}
                  transition={{ duration: 0.8, ease: "circOut" }}
                  className="h-full bg-red-500"
                />
              </div>
              <div className="flex justify-between text-sm font-bold">
                <span className="text-green-500">{(result.scores.human * 100).toFixed(1)}%</span>
                <span className="text-red-500">{(result.scores.ai * 100).toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>

        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-2 border-t border-border/50">
            View Technical Details <ChevronDown size={12} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 p-3 bg-secondary/50 rounded-md font-mono text-[10px] text-muted-foreground overflow-x-auto">
              <pre>{JSON.stringify(result.raw, null, 2)}</pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </m.div>
  )
}