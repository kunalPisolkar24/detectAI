import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

interface GradientPillProps extends ComponentProps<"span"> {
  icon?: LucideIcon;
  hugeIcon?: IconSvgElement;
  animated?: boolean;
}

export function GradientPill({
  icon: Icon,
  hugeIcon,
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
        {hugeIcon ? (
          <HugeiconsIcon
            icon={hugeIcon}
            size={16}
            className="text-blue-500 dark:text-blue-400"
            aria-hidden="true"
          />
        ) : Icon ? (
          <Icon className="size-4 text-blue-500 dark:text-blue-400" aria-hidden="true" />
        ) : null}
        {children}
      </span>
    </span>
  );
}
