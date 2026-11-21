"use client";

import { useMotionValueEvent, useScroll } from "framer-motion";
import { useState } from "react";
import { cn } from "cn";

import { BrandLogo } from "@/components/ui/brand-logo";
import { DesktopNav } from "./desktop-nav";
import { MobileNav } from "./mobile-nav";
import { NavActions } from "./nav-actions";

export function Navigation() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    const next = latest > 20;
    setScrolled((current) => (current === next ? current : next));
  });

  return (
    <header
      className={cn(
        "animate-in fade-in slide-in-from-top-8 fixed inset-x-0 top-0 z-50 flex h-16 items-center border-b duration-500 transition-all",
        scrolled
          ? "border-black/5 bg-white/70 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-black/70"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="flex w-full items-center justify-between gap-4 px-4 sm:px-6">
        <BrandLogo size="nav" />
        <div className="flex items-center gap-4">
          <DesktopNav />
          <NavActions className="hidden border-l border-black/10 pl-4 dark:border-white/10 lg:flex" />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
