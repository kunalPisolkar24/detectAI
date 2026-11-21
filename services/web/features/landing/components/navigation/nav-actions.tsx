import Link from "next/link";
import { LogIn } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

interface NavActionsProps {
  showTheme?: boolean;
  className?: string;
  loginClassName?: string;
}

export function NavActions({
  showTheme = true,
  className,
  loginClassName,
}: NavActionsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showTheme && <ThemeToggle />}
      <Button asChild variant="brand" size="nav" className={loginClassName}>
        <Link href="/login" className="flex items-center gap-2">
          <LogIn className="size-4" aria-hidden="true" />
          <span className="inline-block translate-y-0.5 uppercase">Log in</span>
        </Link>
      </Button>
    </div>
  );
}
