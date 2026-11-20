import type { ComponentProps } from "react";
import { cn } from "cn";

interface GradientTextProps extends ComponentProps<"span"> {
  tone?: "brand" | "cool";
  animate?: boolean;
}

export function GradientText({
  tone = "brand",
  animate = false,
  className,
  ...props
}: GradientTextProps) {
  return (
    <span
      className={cn(
        "bg-gradient-to-r bg-clip-text text-transparent",
        tone === "brand"
          ? "from-foreground via-blue-600 to-foreground dark:via-blue-400"
          : "from-blue-600 via-purple-500 to-blue-600",
        animate && "animate-gradient-x bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}
