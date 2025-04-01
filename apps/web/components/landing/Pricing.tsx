"use client"
import { useState, useEffect } from "react"
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text"
import { cn } from "@workspace/ui/lib/utils"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { CircleCheck, Sparkles } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import Link from "next/link"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"

export const Pricing = () => {
  // State to track whether the user selects "monthly" or "yearly"
  const [billingCycle, setBillingCycle] = useState("monthly")
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Define pricing for both billing cycles
  const products = [
    {
      id: 1,
      name: "Free",
      priceString: billingCycle === "monthly" ? "₹0" : "₹0",
      billingInterval: billingCycle === "monthly" ? "/month" : "/year",
      description: "Get started with AI detection using the Sequential Model.",
      features: [
        "Sequential Model for AI detection",
        "Limited API calls (100/day)",
        "Basic accuracy level",
        "Community support",
      ],
      buttonText: "Get Started",
      buttonVariant: "outline",
    },
    {
      id: 2,
      name: "Premium",
      priceString: billingCycle === "monthly" ? "₹200" : "₹1000",
      billingInterval: billingCycle === "monthly" ? "/month" : "/year",
      description: "Unlock the full power of AI with the BERT Model.",
      features: [
        "Advanced BERT Model for superior AI detection",
        "Unlimited API calls",
        "High accuracy & deep analysis",
        "Priority customer support",
        "Early access to new features",
      ],
      buttonText: "Upgrade Now",
      buttonVariant: "default",
    },
  ]

  if (!mounted) return null

  return (
    <section className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-background text-foreground transition-colors duration-300 py-16 md:py-24">
      {/* Animated background elements */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div
          className={cn(
            "absolute inset-0 animate-gradient-slow",
            theme === "dark"
              ? "bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10"
              : "bg-gradient-to-r from-purple-300/20 via-blue-300/20 to-cyan-300/20",
          )}
        />
        <motion.div
          className={cn(
            "absolute top-1/4 -left-32 w-96 h-96 rounded-full blur-3xl",
            theme === "dark" ? "bg-purple-600/20" : "bg-purple-400/20",
          )}
          animate={{
            x: [0, 50, 0],
            y: [0, 30, 0],
          }}
          transition={{
            duration: 15,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className={cn(
            "absolute bottom-1/4 -right-32 w-96 h-96 rounded-full blur-3xl",
            theme === "dark" ? "bg-blue-600/20" : "bg-blue-400/20",
          )}
          animate={{
            x: [0, -50, 0],
            y: [0, -30, 0],
          }}
          transition={{
            duration: 18,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </div>

      <div className="w-full container px-6 sm:px-8 lg:mx-auto flex flex-col items-center justify-center space-y-8 z-10">
        <div className="text-center flex flex-col items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className={cn(
              "group relative mx-auto flex items-center justify-center rounded-full px-4 py-1.5 transition-shadow duration-500 ease-out",
              theme === "dark"
                ? "shadow-[inset_0_-8px_10px_#8fdfff1f] hover:shadow-[inset_0_-5px_10px_#8fdfff3f]"
                : "shadow-[inset_0_-8px_10px_#8fdfff4f] hover:shadow-[inset_0_-5px_10px_#8fdfff6f]",
            )}
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
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className={cn(
              "mt-4 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-center",
              theme === "dark"
                ? "bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-white bg-[length:200%_100%]"
                : "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900 bg-[length:200%_100%]",
            )}
            style={{
              backgroundPosition: "0% 0%",
              animation: "gradientMove 5s linear infinite",
            }}
          >
            Choose The Plan For AI Text Detection
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className={cn("text-base max-w-xl mt-3 seriffont1", theme === "dark" ? "text-neutral-300" : "text-neutral-600")}
          >
            From simple AI text detection to in-depth analysis with advanced models like BERT, choose the plan that fits
            your requirements.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <Tabs
            onValueChange={setBillingCycle}
            defaultValue="monthly"
            className={cn(
              "border p-1 rounded-xl shadow-md",
              theme === "dark"
                ? "bg-black/40 backdrop-blur-sm border-white/10"
                : "bg-white/70 backdrop-blur-sm border-black/10",
            )}
          >
            <TabsList
              className={cn("grid w-full grid-cols-2 rounded-lg", theme === "dark" ? "bg-black/60" : "bg-white/80")}
            >
              <TabsTrigger className="font-semibold" value="monthly">
                Monthly
              </TabsTrigger>
              <TabsTrigger className="font-semibold" value="yearly">
                Yearly
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </motion.div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 lg:gap-14 mt-8 place-items-center mx-auto w-full">
          {products.map((product, index) => {
            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.5 + index * 0.2 }}
                whileHover={{
                  y: -5,
                  boxShadow:
                    theme === "dark"
                      ? "0 20px 40px -15px rgba(0, 0, 255, 0.3)"
                      : "0 20px 40px -15px rgba(0, 0, 200, 0.2)",
                }}
                className={cn(
                  "border rounded-xl h-full min-h-[450px] w-full max-w-[400px] flex flex-col justify-between divide-y transition-all duration-300",
                  theme === "dark"
                    ? product.name === "Premium"
                      ? "border-blue-500/50 bg-black/50 backdrop-blur-sm"
                      : "border-white/10 bg-black/40 backdrop-blur-sm"
                    : product.name === "Premium"
                      ? "border-blue-500/50 bg-white/80 backdrop-blur-sm"
                      : "border-black/10 bg-white/70 backdrop-blur-sm",
                )}
              >
                <div className="p-6 flex-1">
                  <h2 className="text-2xl leading-6 font-semibold flex items-center justify-between">
                    {product.name}
                    {product.name === "Premium" && (
                      <motion.div
                        initial={{ scale: 0.8 }}
                        animate={{ scale: 1 }}
                        transition={{
                          duration: 0.5,
                          delay: 0.8,
                          type: "spring",
                          stiffness: 200,
                        }}
                      >
                        <Badge
                          className={cn(
                            "font-semibold",
                            theme === "dark"
                              ? "bg-blue-600/80 hover:bg-blue-600 text-white border-blue-500"
                              : "bg-blue-500/80 hover:bg-blue-500 text-white border-blue-400",
                          )}
                        >
                          Most Popular
                        </Badge>
                      </motion.div>
                    )}
                  </h2>

                  {/* Description */}
                  <p className={cn("mt-2", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                    {product.description}
                  </p>

                  {/* Dynamic Price */}
                  <motion.p
                    className="mt-8"
                    animate={{
                      scale: [1, 1.05, 1],
                      transition: { duration: 0.5, delay: billingCycle === "yearly" ? 0.2 : 0 },
                    }}
                  >
                    <span className={cn("text-4xl font-extrabold", theme === "dark" ? "text-white" : "text-gray-900")}>
                      {product.priceString}
                    </span>
                    <span
                      className={cn(
                        "text-base font-medium ml-1",
                        theme === "dark" ? "text-neutral-400" : "text-neutral-600",
                      )}
                    >
                      {product.billingInterval}
                    </span>
                  </motion.p>
                </div>

                {/* Features List */}
                <div
                  className={cn(
                    "pt-6 pb-8 px-6 flex-grow divide-border",
                    theme === "dark" ? "divide-white/10" : "divide-black/10",
                  )}
                >
                  <h3
                    className={cn(
                      "uppercase tracking-wide font-medium text-sm",
                      theme === "dark" ? "text-neutral-300" : "text-neutral-700",
                    )}
                  >
                    WHAT&apos;S INCLUDED
                  </h3>
                  <ul className="mt-6 space-y-4">
                    {product.features.map((feature, i) => (
                      <motion.li
                        className="flex space-x-3"
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: 0.7 + i * 0.1 }}
                      >
                        <CircleCheck
                          className={cn(
                            "w-5 h-5",
                            product.name === "Premium"
                              ? "text-blue-500"
                              : theme === "dark"
                                ? "text-blue-400"
                                : "text-blue-500",
                          )}
                        />
                        <span className={cn("text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-700")}>
                          {feature}
                        </span>
                      </motion.li>
                    ))}
                  </ul>
                </div>

                {/* Subscribe Button at the Bottom */}
                <div className={cn("p-6 border-t", theme === "dark" ? "border-white/10" : "border-black/10")}>
                  <Link href="/auth/login">
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                      <Button
                        className={cn(
                          "w-full font-semibold",
                          product.name === "Premium"
                            ? theme === "dark"
                              ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0"
                              : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0"
                            : theme === "dark"
                              ? "bg-transparent border border-white/20 hover:bg-white/10"
                              : "bg-transparent border border-black/20 hover:bg-black/5",
                        )}
                        variant={product.name === "Premium" ? "default" : "outline"}
                      >
                        {product.name === "Premium" ? "Subscribe" : "Get Started"}
                      </Button>
                    </motion.div>
                  </Link>
                </div>

                {/* Subtle gradient accent at the bottom for Premium */}
                {product.name === "Premium" && (
                  <motion.div
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1, delay: 1 }}
                    className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-b-xl"
                  />
                )}
              </motion.div>
            )
          })}
        </div>

        {/* Additional info */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1 }}
          className={cn(
            "text-sm text-center max-w-xl mt-6",
            theme === "dark" ? "text-neutral-400" : "text-neutral-600",
          )}
        >
          All plans include access to our web interface. Need a custom enterprise plan?
          <Link
            href="/contact"
            className={cn(
              "ml-1 underline underline-offset-2",
              theme === "dark" ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500",
            )}
          >
            Contact us
          </Link>
          .
        </motion.p>
      </div>
    </section>
  )
}

