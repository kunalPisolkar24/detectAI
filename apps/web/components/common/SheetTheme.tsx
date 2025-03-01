"use client";

import * as React from "react";
import { useTheme } from "next-themes";

export function SheetTheme() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null; // Prevent hydration mismatch

  const isDarkMode = resolvedTheme === "dark";
  const nextTheme = isDarkMode ? "light" : "dark";

  return (
    <p
      className="text-sm font-medium text-foreground bg-muted cursor-pointer border p-2 rounded-xl"
      onClick={() => setTheme(nextTheme)}
    >
      {isDarkMode ? "Light Mode" : "Dark Mode"}
    </p>
  );
}
