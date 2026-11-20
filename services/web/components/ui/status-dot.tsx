import type { ComponentProps } from "react";
import { cn } from "cn";

interface StatusDotProps extends Omit<ComponentProps<"span">, "children"> {
  tone?: "success" | "brand" | "danger";
  pulse?: boolean;
  label?: string;
}

const toneClasses = {
  success: "bg-emerald-500",
  brand: "bg-blue-500",
  danger: "bg-red-500",
};

export function StatusDot({
  tone = "success",
  pulse = false,
  label,
  className,
  ...props
}: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} {...props}>
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", toneClasses[tone], pulse && "animate-pulse")}
      />
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
    </span>
  );
}
