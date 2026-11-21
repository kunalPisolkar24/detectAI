"use client";

import { useState } from "react";
import { PanelRight, X } from "lucide-react";

import { BrandLogo } from "@/components/ui/brand-logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NAV_LINKS } from "../../constants";
import { MobileNavLink } from "./mobile-nav-link";
import { NavActions } from "./nav-actions";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 lg:hidden">
        <ThemeToggle />
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open navigation menu">
            <PanelRight />
          </Button>
        </SheetTrigger>
      </div>

      <SheetContent showCloseButton={false} glass className="w-full sm:max-w-md">
        <SheetTitle className="sr-only">Mobile navigation</SheetTitle>
        <div className="flex h-full flex-col p-6">
          <div className="mb-8 flex items-center justify-between">
            <BrandLogo size="nav" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close navigation menu"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>

          <nav className="flex flex-col gap-2" aria-label="Mobile navigation">
            {NAV_LINKS.map((link) => (
              <MobileNavLink
                key={link.href}
                href={link.href}
                label={link.label}
                icon={link.icon}
                onNavigate={() => setOpen(false)}
              />
            ))}
          </nav>

          <NavActions
            showTheme={false}
            className="mt-auto w-full"
            loginClassName="w-full"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
