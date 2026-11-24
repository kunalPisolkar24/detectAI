import * as React from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { cn } from "cn"

interface InputProps extends React.ComponentProps<"input"> {
  icon?: IconSvgElement
}

function Input({ className, type, icon, ...props }: InputProps) {
  const input = (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-red-400/70 dark:aria-invalid:ring-red-400/30",
        icon && "pl-9",
        className
      )}
      {...props}
    />
  )

  if (!icon) return input

  return (
    <div className="relative">
      <HugeiconsIcon
        icon={icon}
        size={16}
        aria-hidden="true"
        className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
      />
      {input}
    </div>
  )
}

export { Input }
