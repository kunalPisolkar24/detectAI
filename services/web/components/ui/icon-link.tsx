import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

interface IconLinkProps {
  href: string;
  icon?: LucideIcon;
  hugeIcon?: IconSvgElement;
  label: string;
  external?: boolean;
  className?: string;
}

export function IconLink({
  href,
  icon: Icon,
  hugeIcon,
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
      {hugeIcon ? (
        <HugeiconsIcon icon={hugeIcon} size={20} aria-hidden="true" />
      ) : Icon ? (
        <Icon className="size-5" aria-hidden="true" />
      ) : null}
    </a>
  );
}
