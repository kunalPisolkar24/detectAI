"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

import { IconTile } from "@/components/ui/icon-tile";

interface MobileNavLinkProps {
  href: string;
  label: string;
  icon: LucideIcon;
  onNavigate?: () => void;
}

export function MobileNavLink({
  href,
  label,
  icon,
  onNavigate,
}: MobileNavLinkProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-4 rounded-xl p-4 transition-colors",
        "hover:bg-black/5 dark:hover:bg-white/5",
      )}
    >
      <IconTile icon={icon} />
      <span className="pt-1 font-display text-xl font-medium uppercase tracking-wide">
        {label}
      </span>
    </Link>
  );
}
