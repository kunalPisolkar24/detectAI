import type { ReactNode } from "react"

import { BrandLogo } from "@/components/ui/brand-logo"
import { ThemeToggle } from "@/components/ui/theme-toggle"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-purple-300/30 via-blue-300/30 to-cyan-300/30 dark:from-purple-300/20 dark:via-blue-300/20 dark:to-cyan-300/20"
      />
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        <BrandLogo />
        {children}
      </div>
    </main>
  )
}
