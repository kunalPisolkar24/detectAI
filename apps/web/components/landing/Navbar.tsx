import React from "react";
import { Logo } from "@/components/common";
import Link from "next/link";
import { Button } from "@workspace/ui/components/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@workspace/ui/components/sheet";
import { PanelRight } from "lucide-react";
import { ModeToggle } from "@/components/common";
import { SheetTheme } from "@/components/common";

const NavItems = () => {
  return (
    <>
      <Link href="/docs" className="text-sm font-medium  underline-offset-4 border md:border-hidden p-2 rounded-xl">Docs</Link>
      <Link href="/features" className="text-sm font-medium  underline-offset-4 border md:border-hidden p-2 rounded-xl">Features</Link>
      <Link href="/pricing" className="text-sm font-medium  underline-offset-4 border md:border-hidden p-2 rounded-xl">Pricing</Link>

      <Link href="/faqs" className="text-sm font-medium  underline-offset-4 border md:border-hidden p-2 rounded-xl">FAQs</Link>

      <Link href="/chat" className="text-sm font-medium  underline-offset-4 border md:border-hidden p-2 rounded-xl">Detect AI</Link>

      {/* ModeToggle is visible from `md` and above, hidden on `sm` */}
      <div className="hidden md:block">
        <ModeToggle />
      </div>

      {/* SheetTheme is only visible on `sm` (mobile) */}
      <div className="md:hidden">
        <SheetTheme />
      </div>

      <Link href="login" className="text-sm font-medium  underline-offset-4">
        <Button className="border w-full" variant="secondary">Log in</Button>
      </Link>
    </>
  );
};

export const Navigation = () => {
  return (
    <div className="w-full bg-background/80 backdrop-blur-md fixed top-0 px-8 py-2 z-50 shadow-sm overflow-hidden">
      <header className="container mx-auto flex items-center">
        <Logo />

        <nav aria-label="Main navigation" className="ml-auto hidden md:flex items-center justify-center gap-6">
          <NavItems />
        </nav>

        {/* Mobile navigation */}
        <div className="ml-auto md:hidden overflow-hidden">
          <Sheet>
            <SheetTrigger asChild>
              <PanelRight className="h-6 w-6" strokeWidth={1.5} />
            </SheetTrigger>
            <SheetContent>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <nav aria-label="Mobile navigation" className="flex flex-col gap-4 mt-12">
                <NavItems />
              </nav>
            </SheetContent>
          </Sheet>
        </div>

      </header>
    </div>
  );
};

