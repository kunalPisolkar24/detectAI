import { ModelType } from "../types"

export const formatPercentage = (value: number): string => {
  return `${Math.round(value * 100)}%`
}

export const getModelDisplayName = (model: ModelType): string => {
  return model === "spark" ? "Spark" : "Flare"
}

export const getAnalysisConfig = (isAI: boolean) => {
  if (isAI) {
    return {
      label: "AI-GENERATED",
      colors: {
        text: "text-purple-600 dark:text-purple-300",
        bg: "bg-purple-100 dark:bg-purple-500/20",
        border: "border-purple-200 dark:border-purple-500/20",
        dot: "bg-purple-500"
      }
    }
  }
  
  return {
    label: "HUMAN-WRITTEN",
    colors: {
      text: "text-emerald-600 dark:text-emerald-300",
      bg: "bg-emerald-100 dark:bg-emerald-500/20",
      border: "border-emerald-200 dark:border-emerald-500/20",
      dot: "bg-emerald-500"
    }
  }
}