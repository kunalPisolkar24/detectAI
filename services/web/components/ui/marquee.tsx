import type { ComponentProps, CSSProperties } from "react";
import { cn } from "cn";

interface MarqueeProps extends ComponentProps<"div"> {
  reverse?: boolean;
  pauseOnHover?: boolean;
  vertical?: boolean;
  repeat?: number;
  duration?: string;
  gap?: string;
}

export function Marquee({
  reverse = false,
  pauseOnHover = false,
  vertical = false,
  repeat = 4,
  duration = "40s",
  gap = "1rem",
  className,
  style,
  children,
  ...props
}: MarqueeProps) {
  return (
    <div
      className={cn("group flex overflow-hidden p-2", className)}
      style={{ "--duration": duration, "--gap": gap, ...style } as CSSProperties}
      {...props}
    >
      {Array.from({ length: repeat }, (_, index) => (
        <div
          key={index}
          className={cn(
            "flex shrink-0 justify-around gap-[var(--gap)]",
            vertical ? "flex-col animate-marquee-vertical" : "flex-row animate-marquee",
            reverse && "[animation-direction:reverse]",
            pauseOnHover && "group-hover:[animation-play-state:paused]",
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
