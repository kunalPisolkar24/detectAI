"use client"

import { memo } from "react"
import Image from "next/image"
import { m } from "framer-motion"
import { cn } from "@/lib/core/utils"

interface ReviewCardProps {
  img: string
  name: string
  username: string
  body: string
}

const ReviewCard = memo(({ img, name, username, body }: ReviewCardProps) => {
  return (
    <m.figure
      whileHover={{ scale: 1.03 }}
      className={cn(
        "relative h-full w-64 cursor-pointer overflow-hidden rounded-xl border p-4 transition-all duration-300 mx-2",
        "border-black/10 bg-white/70 backdrop-blur-sm hover:bg-white/80 hover:shadow-[0_10px_30px_-15px_rgba(0,0,200,0.2)]",
        "dark:border-white/10 dark:bg-black/50 dark:hover:bg-black/60 dark:hover:shadow-[0_10px_30px_-15px_rgba(0,0,255,0.3)]"
      )}
    >
      <div className="flex flex-row items-center gap-2">
        <Image
          className="rounded-full"
          width={32}
          height={32}
          alt={`${name}'s avatar`}
          src={img}
          loading="lazy"
        />
        <div className="flex flex-col">
          <figcaption className="text-sm font-medium text-gray-900 dark:text-white">
            {name}
          </figcaption>
          <p className="text-xs font-medium text-gray-500 dark:text-white/40">
            {username}
          </p>
        </div>
      </div>
      <blockquote className="mt-2 text-sm text-gray-700 dark:text-gray-300">
        {body}
      </blockquote>

      <div className="absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-blue-500 to-purple-500" />
    </m.figure>
  )
})

ReviewCard.displayName = "ReviewCard"
export { ReviewCard }