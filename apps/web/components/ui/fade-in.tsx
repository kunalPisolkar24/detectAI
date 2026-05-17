"use client"

import { m, HTMLMotionProps } from "framer-motion"
import { cn } from "@/lib/core/utils"

interface FadeInProps extends HTMLMotionProps<"div"> {
  delay?: number
  duration?: number
  className?: string
}

export const FadeIn = ({ 
  children, 
  delay = 0, 
  duration = 0.5, 
  className,
  ...props 
}: FadeInProps) => {
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration, delay }}
      className={cn(className)}
      {...props}
    >
      {children}
    </m.div>
  )
}