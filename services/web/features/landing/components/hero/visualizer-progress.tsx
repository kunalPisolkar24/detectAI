"use client";

import { m } from "framer-motion";

interface VisualizerProgressProps {
  active?: boolean;
}

export function VisualizerProgress({ active = true }: VisualizerProgressProps) {
  return (
    <m.div
      className="mt-4 h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
      initial={{ width: "0%" }}
      animate={{ width: active ? "100%" : "0%" }}
      transition={
        active
          ? {
              duration: 3,
              repeat: Number.POSITIVE_INFINITY,
              ease: "linear",
            }
          : { duration: 0 }
      }
    />
  );
}
