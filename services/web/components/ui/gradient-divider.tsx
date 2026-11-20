import type { ComponentProps } from "react";
import { cn } from "cn";

interface GradientDividerProps extends ComponentProps<"div"> {
  vertical?: boolean;
}

export function GradientDivider({
  vertical = false,
  className,
  ...props
}: GradientDividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(
        vertical
          ? "h-full w-px bg-gradient-to-b from-blue-500 to-purple-500"
          : "h-px w-full bg-gradient-to-r from-blue-500 to-purple-500",
        className,
      )}
      {...props}
    />
  );
}
