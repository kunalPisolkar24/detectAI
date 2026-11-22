import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

const toneClasses = {
  brand: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
  muted: "bg-muted text-muted-foreground",
  purple: "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400",
};

const borderToneClasses = {
  brand: "border-blue-500/50 dark:border-blue-400/50",
  muted: "border-border",
  purple: "border-purple-500/50 dark:border-purple-400/50",
};

const sizeClasses = {
  sm: "size-8",
  md: "size-10",
};

interface IconTileProps {
  icon: LucideIcon;
  tone?: keyof typeof toneClasses;
  size?: keyof typeof sizeClasses;
  bordered?: boolean;
  className?: string;
}

export function IconTile({
  icon: Icon,
  tone = "brand",
  size = "md",
  bordered = false,
  className,
}: IconTileProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg",
        sizeClasses[size],
        toneClasses[tone],
        bordered && `border ${borderToneClasses[tone]}`,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} aria-hidden="true" />
    </span>
  );
}
