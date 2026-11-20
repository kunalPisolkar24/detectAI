import type { ComponentProps } from "react";
import { cn } from "cn";

interface GlassPanelProps extends ComponentProps<"div"> {
  elevated?: boolean;
}

export function GlassPanel({
  elevated = false,
  className,
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-black/10 bg-white/70 backdrop-blur-sm",
        "dark:border-white/10 dark:bg-black/40",
        elevated && "dark:bg-black/60",
        className,
      )}
      {...props}
    />
  );
}
