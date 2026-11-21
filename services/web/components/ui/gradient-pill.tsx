import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

interface GradientPillProps extends ComponentProps<"span"> {
  icon?: LucideIcon;
  animated?: boolean;
}

export function GradientPill({
  icon: Icon,
  animated = false,
  className,
  children,
  ...props
}: GradientPillProps) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full bg-gradient-to-r from-blue-500 to-purple-500 p-px",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full bg-background px-4 py-1.5 text-sm font-medium backdrop-blur-md dark:bg-background/60",
          animated && "animate-gradient-x",
        )}
      >
        {Icon && <Icon className="size-4 text-blue-500 dark:text-blue-400" aria-hidden="true" />}
        {children}
      </span>
    </span>
  );
}
