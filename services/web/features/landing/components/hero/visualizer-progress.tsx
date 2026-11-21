"use client";

import { m } from "framer-motion";

export function VisualizerProgress() {
  return (
    <m.div
      className="mt-4 h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
      initial={{ width: "0%" }}
      animate={{ width: "100%" }}
      transition={{
        duration: 3,
        repeat: Number.POSITIVE_INFINITY,
        ease: "linear",
      }}
    />
  );
}
