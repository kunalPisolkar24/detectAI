import type { ComponentProps } from "react";
import { cn } from "cn";

interface GlassPanelProps extends ComponentProps<"div"> {
  elevated?: boolean;
  brand?: boolean;
}

export function GlassPanel({
  elevated = false,
  brand = false,
  className,
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white/70 backdrop-blur-sm",
        brand
          ? "border-blue-500/60 dark:border-purple-400/60"
          : "border-black/10 dark:border-white/10",
        "dark:bg-black/40",
        elevated && "dark:bg-black/60",
        className,
      )}
      {...props}
    />
  );
}
