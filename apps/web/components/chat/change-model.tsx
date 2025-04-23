"use client"
import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useTheme } from "next-themes"
import { cn } from "@workspace/ui/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@workspace/ui/components/dropdown-menu"
import { Button } from "@workspace/ui/components/button"
import { ChevronDown, Cpu, Brain, Lock } from "lucide-react"
import { useTab } from "@/contexts/tabContext"

const ChangeModel = () => {
  const { tab, setTab } = useTab()
  const { theme } = useTheme()
  const { data: session, status } : any = useSession() 
  const [mounted, setMounted] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const isPremium = session?.user?.isPremium ?? false
  const isLoadingSession = status === "loading"
console.log("Session JSON:", JSON.stringify(session));

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted && status === "authenticated" && !isPremium && tab === "bert") {
      setTab("sequential")
    }
  }, [mounted, status, isPremium, tab, setTab])

  const effectiveTab =
    mounted && status === "authenticated" && !isPremium && tab === "bert"
      ? "sequential"
      : tab

  if (!mounted || isLoadingSession) {
    return (
      <div 
      data-testid="loading-state"
      className="w-[180px] h-10 rounded-md border border-input bg-background px-3 py-2 text-sm animate-pulse">
        <div className="h-4 w-2/3 bg-muted rounded"></div>
      </div>
    )
  }

  const models = [
    {
      id: "sequential",
      name: "Sequential",
      icon: Cpu,
      description: "Standard model for AI detection",
      isPremiumOnly: false,
    },
    {
      id: "bert",
      name: "BERT",
      icon: Brain,
      description: "Advanced model (Premium)", 
      isPremiumOnly: true,
    },
  ]

  const selectedModel : any = models.find((model) => model.id === effectiveTab) || models[0]

  return (
    <DropdownMenu onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[180px] text-left justify-between transition-all duration-200",
            theme === "dark"
              ? "border-white/20 hover:border-white/40 hover:bg-white/5"
              : "border-black/20 hover:border-black/40 hover:bg-black/5",
            isOpen && (theme === "dark" ? "border-white/40 bg-white/5" : "border-black/40 bg-black/5"),
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <selectedModel.icon
              size={16}
              className={cn(
                selectedModel.id === "sequential"
                  ? theme === "dark"
                    ? "text-blue-400"
                    : "text-blue-600"
                  : theme === "dark"
                    ? "text-purple-400"
                    : "text-purple-600",
              )}
            />
            <span>{selectedModel.name}</span>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-200",
              isOpen ? "rotate-180" : "rotate-0",
              theme === "dark" ? "text-white/70" : "text-black/70",
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(
          "w-[220px] p-1 z-50 border",
          theme === "dark"
            ? "bg-black/90 backdrop-blur-sm border-white/10"
            : "bg-white backdrop-blur-sm border-black/10",
        )}
      >
        {models.map((model) => {
          const isDisabled = model.isPremiumOnly && !isPremium

          return (
            <DropdownMenuItem
              key={model.id}
              disabled={isDisabled} 
              className={cn(
                "flex flex-col items-start py-2 px-3 cursor-pointer gap-0.5 rounded-sm transition-opacity",
                effectiveTab === model.id
                  ? theme === "dark"
                    ? "bg-white/10"
                    : "bg-black/5"
                  : "hover:bg-white/5 dark:hover:bg-white/5",
                isDisabled && "opacity-60 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent", // Styles for disabled state
              )}
              onClick={() => {
                if (!isDisabled) {
                  setTab(model.id)
                }
              }}
              onSelect={(e) => isDisabled && e.preventDefault()}
            >
              <div className="flex items-center justify-between gap-2 w-full">
                 <div className="flex items-center gap-2">
                    <model.icon
                      size={16}
                      className={cn(
                        model.id === "sequential"
                          ? theme === "dark"
                            ? "text-blue-400"
                            : "text-blue-600"
                          : theme === "dark"
                            ? "text-purple-400"
                            : "text-purple-600",
                      )}
                    />
                    <span
                      className={cn(
                        "font-medium",
                        effectiveTab === model.id
                          ? theme === "dark"
                            ? "text-white"
                            : "text-black"
                          : theme === "dark"
                            ? "text-white/80"
                            : "text-black/80",
                      )}
                    >
                      {model.name}
                    </span>
                 </div>
                 {isDisabled && <Lock size={12} className={theme === 'dark' ? "text-white/50" : "text-black/50"} />}
              </div>
              <span className={cn("text-xs pl-[24px]", theme === "dark" ? "text-white/60" : "text-black/60")}>
                {isDisabled ? "Requires Premium subscription" : model.description}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ChangeModel;