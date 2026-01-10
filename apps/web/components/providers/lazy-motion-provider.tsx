"use client"

import { LazyMotion, domMax } from "framer-motion"
import { ReactNode } from "react"

interface LazyMotionProviderProps {
  children: ReactNode
}

export function LazyMotionProvider({ children }: LazyMotionProviderProps) {
  return (
    <LazyMotion features={domMax} strict>
      {children}
    </LazyMotion>
  )
}