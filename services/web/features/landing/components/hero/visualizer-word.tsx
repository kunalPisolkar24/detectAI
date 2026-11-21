"use client";

import { m } from "framer-motion";
import { cn } from "cn";

interface VisualizerWordProps {
  word: string;
  index: number;
}

export function VisualizerWord({ word, index }: VisualizerWordProps) {
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
      animate={{ opacity: 1 }}
      transition={{
        duration: 0.2,
        delay: (index * 0.05) % 2,
        repeat: Number.POSITIVE_INFINITY,
        repeatType: "reverse",
      }}
    >
      {word}
    </m.span>
  );
}
