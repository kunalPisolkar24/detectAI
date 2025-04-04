"use client"
import Link from "next/link"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { ArrowLeft } from "lucide-react"

interface BackButtonProps {
  label: string
  href: string
}

export const BackButton = ({ label, href }: BackButtonProps) => {
  const { theme } = useTheme()

  return (
    <motion.div whileHover={{ x: -3 }} whileTap={{ scale: 0.97 }} className="w-full">
      <Button
        variant="link"
        className={cn(
          "font-normal w-full justify-center sm:justify-start gap-1",
          theme === "dark" ? "text-neutral-300 hover:text-white" : "text-neutral-700 hover:text-black",
        )}
        size="sm"
        asChild
      >
        <Link href={href}>
          <ArrowLeft size={16} className="opacity-70" />
          {label}
        </Link>
      </Button>
    </motion.div>
  )
}

