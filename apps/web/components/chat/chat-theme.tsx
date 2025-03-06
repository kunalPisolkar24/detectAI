"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";

export function ChatTheme() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null; // Prevent hydration mismatch

  const isDarkMode = resolvedTheme === "dark";
  const nextTheme = isDarkMode ? "light" : "dark";

  return (
    <DropdownMenuItem
      className="rounded-sm cursor-pointer"
      onClick={() => {
        setTheme(nextTheme);
      }}
    >
      {isDarkMode ? "Light Mode" : "Dark Mode"}
    </DropdownMenuItem>
  );
}

