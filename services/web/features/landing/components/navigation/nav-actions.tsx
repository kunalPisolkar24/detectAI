import Link from "next/link";
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
      <Button asChild variant="brand" className={loginClassName}>
        <Link href="/login">Log in</Link>
      </Button>
    </div>
  );
}
