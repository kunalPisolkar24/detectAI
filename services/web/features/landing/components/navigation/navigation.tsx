"use client";

import { useMotionValueEvent, useScroll } from "framer-motion";
import { useState } from "react";
import { cn } from "cn";

import { Container } from "@/components/layout/container";
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
        "animate-in fade-in slide-in-from-top-8 fixed inset-x-0 top-0 z-50 border-b duration-500 transition-all",
        scrolled
          ? "border-black/5 bg-white/70 py-3 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-black/70"
          : "border-transparent bg-transparent py-5",
      )}
    >
      <Container className="flex items-center justify-between gap-4">
        <BrandLogo />
        <DesktopNav />
        <NavActions className="hidden lg:flex" />
        <MobileNav />
      </Container>
    </header>
  );
}
