"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { Sparkles } from "lucide-react"
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { merriweather } from "@/lib/fonts"
import { PRICING_PLANS } from "./constants"
import { PricingCard } from "./components/pricing-card"

export const Pricing = () => {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly")

  return (
    <section className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-background text-foreground transition-colors duration-300 py-16 md:py-24">
      <div className="w-full container px-6 sm:px-8 lg:mx-auto flex flex-col items-center justify-center space-y-8 z-10">
        <div className="text-center flex flex-col items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="group relative mx-auto flex items-center justify-center rounded-full px-4 py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] transition-shadow duration-500 ease-out hover:shadow-[inset_0_-5px_10px_#8fdfff3f] border border-black/5 dark:border-white/5 bg-background/50 backdrop-blur-md"
          >
            <span
              className={cn(
                "absolute inset-0 block h-full w-full animate-gradient rounded-[inherit] bg-gradient-to-r from-[#ffaa40]/50 via-[#9c40ff]/50 to-[#ffaa40]/50 bg-[length:300%_100%] p-[1px]",
              )}
              style={{
                WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                WebkitMaskComposite: "destination-out",
                mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                maskComposite: "subtract",
                WebkitClipPath: "padding-box",
              }}
            />
            <motion.span
              animate={{ rotate: [0, 5, 0] }}
              transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
              className="mr-2"
            >
              <Sparkles className="h-4 w-4 text-yellow-400" />
            </motion.span>
            <AnimatedGradientText className="text-sm font-medium">Pricing</AnimatedGradientText>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className={cn(
              "mt-4 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-center bg-clip-text text-transparent bg-gradient-to-r bg-[length:200%_100%] animate-gradient-x",
              "from-gray-900 via-blue-600 to-gray-900",
              "dark:from-white dark:via-blue-400 dark:to-white"
            )}
          >
            Choose The Plan For AI Text Detection
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className={cn(
              "text-sm md:text-base max-w-xl mt-3 text-neutral-600 dark:text-neutral-300 tracking-wide",
              merriweather.className
            )}
          >
            From simple AI text detection to in-depth analysis with advanced models, choose the plan that fits your requirements.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <Tabs
            onValueChange={(val) => setBillingCycle(val as "monthly" | "yearly")}
            defaultValue="monthly"
            className="border p-1 rounded-xl shadow-md bg-white/70 backdrop-blur-sm border-black/10 dark:bg-black/40 dark:border-white/10"
          >
            <TabsList className="grid w-full grid-cols-2 rounded-lg bg-white/80 dark:bg-black/60">
              <TabsTrigger className="font-semibold" value="monthly">
                Monthly
              </TabsTrigger>
              <TabsTrigger className="font-semibold" value="yearly">
                Yearly
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 lg:gap-14 mt-8 place-items-center mx-auto w-full max-w-5xl">
          {PRICING_PLANS.map((plan, index) => (
            <PricingCard 
              key={plan.id} 
              plan={plan} 
              billingCycle={billingCycle} 
              index={index} 
            />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 1 }}
          className="text-sm text-center max-w-xl mt-6 text-neutral-600 dark:text-neutral-400"
        >
          All plans include access to our web interface. Need a custom enterprise plan?
          <Link
            href="/contact"
            className="ml-1 underline underline-offset-2 text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Contact us
          </Link>
          .
        </motion.p>
      </div>
    </section>
  )
}