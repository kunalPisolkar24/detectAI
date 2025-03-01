"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@workspace/ui/components/button"

export function ModeToggle() {
  const { setTheme, theme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true) // Ensure component only renders once theme is available
  }, [])

  if (!mounted) return null // Prevents mismatches by not rendering until mounted

  return (
    <Button variant="outline" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      <Sun className={`h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 ${theme === "dark" ? "hidden" : "block"}`} />
      <Moon className={`absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 ${theme === "light" ? "hidden" : "block"}`} />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
