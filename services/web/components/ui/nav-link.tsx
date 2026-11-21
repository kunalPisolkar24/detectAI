"use client";

import Link from "next/link";
import { m } from "framer-motion";
import { useState, type ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

interface NavLinkProps extends Omit<ComponentProps<typeof Link>, "children"> {
  label: string;
  active?: boolean;
  icon?: LucideIcon;
}

export function NavLink({
  label,
  active = false,
  icon: Icon,
  className,
  onMouseEnter,
  onMouseLeave,
  ...props
}: NavLinkProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      {...props}
      className={cn(
        "relative inline-flex translate-y-0.5 items-center gap-2 py-1 font-display text-xl font-medium tracking-wide uppercase text-muted-foreground transition-colors hover:text-foreground",
        active && "text-foreground",
        className,
      )}
      onMouseEnter={(event) => {
        setHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        onMouseLeave?.(event);
      }}
    >
      {Icon && <Icon className="size-4" aria-hidden="true" />}
      {label}
      {(active || hovered) && (
        <m.span
          layoutId="nav-underline"
          className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-gradient-to-r from-blue-600 to-purple-600"
          initial={{ opacity: 0, width: "0%" }}
          animate={{ opacity: 1, width: "100%" }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
        />
      )}
    </Link>
  );
}
