import Link from "next/link";
import { Bot } from "lucide-react";
import { cn } from "cn";

const textSizes = {
  sm: "text-xl",
  md: "text-3xl",
  lg: "text-4xl",
};

const iconSizes = {
  sm: "size-5",
  md: "size-8",
  lg: "size-10",
};

interface BrandLogoProps {
  size?: keyof typeof textSizes;
  showWordmark?: boolean;
  href?: string;
  className?: string;
}

export function BrandLogo({
  size = "md",
  showWordmark = true,
  href = "/",
  className,
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 text-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400",
        className,
      )}
    >
      <Bot
        className={cn(iconSizes[size], "shrink-0 text-blue-600 dark:text-blue-400")}
        aria-hidden="true"
      />
      {showWordmark && (
        <span className={cn("font-display font-medium leading-none tracking-wide", textSizes[size])}>
          Detect AI
        </span>
      )}
    </Link>
  );
}
