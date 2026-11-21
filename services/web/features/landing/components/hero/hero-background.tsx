"use client";

import { m } from "framer-motion";

export function HeroBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 animate-gradient-slow bg-gradient-to-r from-purple-300/30 via-blue-300/30 to-cyan-300/30 opacity-20 dark:from-purple-500/20 dark:via-blue-500/20 dark:to-cyan-500/20" />
      <m.div
        className="absolute -left-32 top-1/4 size-96 rounded-full bg-purple-400 opacity-30 blur-3xl dark:bg-purple-600"
        animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
        transition={{
          duration: 15,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
      <m.div
        className="absolute -right-32 bottom-1/4 size-96 rounded-full bg-blue-400 opacity-30 blur-3xl dark:bg-blue-600"
        animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
        transition={{
          duration: 18,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
    </div>
  );
}
