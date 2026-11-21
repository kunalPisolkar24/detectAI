"use client";

import { m } from "framer-motion";
import { cn } from "cn";

interface VisualizerWordProps {
  word: string;
  index: number;
  active?: boolean;
}

export function VisualizerWord({ word, index, active = true }: VisualizerWordProps) {
  return (
    <m.span
      className={cn(
        "mb-1 inline-block",
        index % 5 === 0
          ? "text-blue-600 dark:text-blue-400"
          : index % 7 === 0
            ? "text-purple-600 dark:text-purple-400"
            : "text-foreground",
      )}
      initial={{ opacity: 0.3 }}
      animate={{ opacity: active ? 1 : 0.3 }}
      transition={
        active
          ? {
              duration: 0.2,
              delay: (index * 0.05) % 2,
              repeat: Number.POSITIVE_INFINITY,
              repeatType: "reverse",
            }
          : { duration: 0 }
      }
    >
      {word}
    </m.span>
  );
}
