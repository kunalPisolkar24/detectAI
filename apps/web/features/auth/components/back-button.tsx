"use client"

import Link from "next/link"
import { m } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

interface BackButtonProps {
  label: string
  href: string
}

export const BackButton = ({ label, href }: BackButtonProps) => {
  return (
    <m.div 
      whileHover={{ x: -2 }} 
      className="w-full flex justify-center"
    >
      <Button
        variant="link"
        className="font-normal text-neutral-600 dark:text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        size="sm"
        asChild
      >
        <Link href={href} className="flex items-center gap-2">
          <ArrowLeft size={16} />
          {label}
        </Link>
      </Button>
    </m.div>
  )
}