"use client"

import { memo } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { CircleCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface PricingCardProps {
  plan: {
    id: string
    name: string
    description: string
    price: { monthly: string; yearly: string }
    features: string[]
    popular: boolean
    cta: string
  }
  billingCycle: "monthly" | "yearly"
  index: number
}

const PricingCard = memo(({ plan, billingCycle, index }: PricingCardProps) => {
  const isPopular = plan.popular

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: index * 0.2 }}
      whileHover={{ y: -5 }}
      className={cn(
        "relative flex flex-col justify-between border rounded-xl h-full min-h-[450px] w-full max-w-[400px] transition-all duration-300",
        "bg-white/70 backdrop-blur-sm border-black/10 hover:shadow-[0_20px_40px_-15px_rgba(0,0,200,0.2)]",
        "dark:bg-black/40 dark:backdrop-blur-sm dark:border-white/10 dark:hover:shadow-[0_20px_40px_-15px_rgba(0,0,255,0.3)]",
        isPopular && "dark:bg-black/50 dark:border-blue-500/50 border-blue-500/50 bg-white/80"
      )}
    >
      <div className="p-6 flex-1">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-semibold">{plan.name}</h3>
          {isPopular && (
            <Badge className="bg-blue-500/80 hover:bg-blue-500 text-white border-blue-400">
              Most Popular
            </Badge>
          )}
        </div>

        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {plan.description}
        </p>

        <div className="mt-8 flex items-baseline">
          <motion.span
            key={billingCycle}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-4xl font-extrabold text-gray-900 dark:text-white"
          >
            {plan.price[billingCycle]}
          </motion.span>
          <span className="ml-1 text-base font-medium text-neutral-600 dark:text-neutral-400">
            /{billingCycle === "monthly" ? "month" : "year"}
          </span>
        </div>
      </div>

      <div className="px-6 pb-6 flex-grow">
        <div className="h-px w-full bg-black/10 dark:bg-white/10 mb-6" />
        <h4 className="text-sm font-medium tracking-wide text-neutral-700 dark:text-neutral-300 uppercase">
          What&apos;s Included
        </h4>
        <ul className="mt-4 space-y-4">
          {plan.features.map((feature, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: 0.5 + i * 0.1 }}
              className="flex items-start gap-3"
            >
              <CircleCheck className={cn("w-5 h-5 shrink-0", isPopular ? "text-blue-500" : "text-blue-500 dark:text-blue-400")} />
              <span className="text-sm text-neutral-700 dark:text-neutral-300 leading-tight">
                {feature}
              </span>
            </motion.li>
          ))}
        </ul>
      </div>

      <div className="p-6 pt-0">
        <Button
          asChild
          className={cn(
            "w-full font-semibold transition-all",
            isPopular
              ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0 shadow-lg shadow-blue-500/20"
              : "bg-transparent border border-black/20 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          )}
          variant={isPopular ? "default" : "outline"}
        >
          <Link href={isPopular ? "/signup" : "/signup"}>
            {plan.cta}
          </Link>
        </Button>
      </div>

      {isPopular && (
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-b-xl" />
      )}
    </motion.div>
  )
})

PricingCard.displayName = "PricingCard"
export { PricingCard }