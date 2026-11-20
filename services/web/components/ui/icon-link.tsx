import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

interface IconLinkProps {
  href: string;
  icon: LucideIcon;
  label: string;
  external?: boolean;
  className?: string;
}

export function IconLink({
  href,
  icon: Icon,
  label,
  external = false,
  className,
}: IconLinkProps) {
  return (
    <a
      href={href}
      aria-label={label}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-black/5 p-2 text-foreground transition-colors hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </a>
  );
}
