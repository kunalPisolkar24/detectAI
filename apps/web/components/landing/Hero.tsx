"use client"
import { useEffect, useState } from "react"
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import Link from "next/link"
import { ArrowRight, ChevronRight, Zap } from "lucide-react"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"
import "./style.css"

export const HeroSection = () => {
  const [mounted, setMounted] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <section className="w-full relative overflow-hidden min-h-screen flex flex-col items-center justify-center bg-background text-foreground transition-colors duration-300">
      {/* Animated background gradient */}
      <div className="absolute inset-0 opacity-20">
        <div
          className={cn(
            "absolute inset-0 animate-gradient-slow",
            theme === "dark"
              ? "bg-gradient-to-r from-purple-500/20 via-blue-500/20 to-cyan-500/20"
              : "bg-gradient-to-r from-purple-300/30 via-blue-300/30 to-cyan-300/30",
          )}
        />
        <motion.div
          className={cn(
            "absolute top-1/4 -left-32 w-96 h-96 rounded-full blur-3xl",
            theme === "dark" ? "bg-purple-600/30" : "bg-purple-400/30",
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
            theme === "dark" ? "bg-blue-600/30" : "bg-blue-400/30",
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

      <div className="relative w-full max-w-5xl mx-auto flex flex-col items-center justify-center space-y-8 text-center z-40 px-4 sm:px-6 mt-[150px] mb-[40px]">
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
            animate={{ rotate: [0, 15, 0] }}
            transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          >
            🚀
          </motion.span>
          <hr className="mx-2 h-4 w-px shrink-0 bg-neutral-500" />
          <AnimatedGradientText className="text-sm font-medium">Introducing Detect AI</AnimatedGradientText>
          <ChevronRight className="ml-1 size-4 stroke-neutral-500 transition-transform duration-300 ease-in-out group-hover:translate-x-0.5" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="space-y-4"
        >
          <h1 className="text-4xl sm:text-6xl lg:text-8xl font-extrabold tracking-tighter">
            <motion.span
              initial={{ backgroundPosition: "0% 0%" }}
              animate={{ backgroundPosition: "100% 0%" }}
              transition={{ duration: 5, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
              className={cn(
                "bg-clip-text text-transparent bg-[length:200%_100%]",
                theme === "dark"
                  ? "bg-gradient-to-r from-white via-blue-400 to-white"
                  : "bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900",
              )}
            >
              Detect your text
            </motion.span>
            <motion.span
              className="block"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.4 }}
            >
              in Seconds!
            </motion.span>
          </h1>
          <motion.p
            className={cn(
              "seriffont mx-auto max-w-3xl text-xl mb-8 px-4 sm:px-6 tracking-tighter",
              theme === "dark" ? "text-neutral-300" : "text-neutral-600",
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.6 }}
          >
            Provide your text, and our model will predict its classification.<br/>
            Fast and efficient predictions in seconds.
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.8 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Link href="/signup">
            <Button
              className={cn(
                "rounded-md text-base h-12 px-6 border-0 shadow-lg group",
                theme === "dark"
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-blue-700/20"
                  : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white shadow-blue-500/20",
              )}
              variant="default"
            >
              Get started!
              <motion.span
                className="ml-2 inline-block"
                animate={{ x: [0, 4, 0] }}
                transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
              >
                <ArrowRight className="size-5" />
              </motion.span>
            </Button>
          </Link>
        </motion.div>

        {/* Animated text detection visualization */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1 }}
          className={cn(
            "relative mt-12 w-full max-w-3xl mx-auto backdrop-blur-sm rounded-xl p-6 overflow-hidden",
            theme === "dark" ? "bg-black/50 border border-white/10" : "bg-white/70 border border-black/10",
          )}
        >
          <div className="flex items-center space-x-2 mb-4">
            <Zap className="text-yellow-400" size={20} />
            <span className="text-sm font-medium">AI Detection in Progress</span>
          </div>

          <TextDetectionAnimation />
        </motion.div>
      </div>
    </section>
  )
}

const TextDetectionAnimation = () => {
  const { theme } = useTheme()
  const sampleText =
    "This text is being analyzed by our advanced AI detection algorithm to determine if it was written by a human or generated by AI. Our model processes patterns, structures, and linguistic features to provide accurate classification in seconds."

  return (
    <div className="font-mono text-sm text-left">
      {sampleText.split(" ").map((word, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0.3 }}
          animate={{
            opacity: 1,
            color:
              index % 5 === 0
                ? theme === "dark"
                  ? "#60a5fa"
                  : "#2563eb"
                : index % 7 === 0
                  ? theme === "dark"
                    ? "#c084fc"
                    : "#7c3aed"
                  : theme === "dark"
                    ? "white"
                    : "black",
          }}
          transition={{
            duration: 0.2,
            delay: (index * 0.05) % 2,
            repeat: Number.POSITIVE_INFINITY,
            repeatType: "reverse",
          }}
          className="inline-block mr-1 mb-1"
        >
          {word}
        </motion.span>
      ))}

      <motion.div
        className="h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 mt-4"
        initial={{ width: "0%" }}
        animate={{ width: "100%" }}
        transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY }}
      />

      <div className="flex justify-between mt-2 text-xs">
        <span className={theme === "dark" ? "text-neutral-400" : "text-neutral-600"}>Analyzing patterns...</span>
        <motion.span
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
          className={theme === "dark" ? "text-neutral-400" : "text-neutral-600"}
        >
          Processing...
        </motion.span>
      </div>
    </div>
  )
}

