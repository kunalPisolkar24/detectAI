"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function PasswordInput({ ref, className, disabled, ...props }: React.ComponentProps<"input">) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-9", className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={visible ? "Hide password" : "Show password"}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  )
}

export { PasswordInput }
