"use client"
import { useEffect, useState } from "react"
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text"
import { cn } from "@workspace/ui/lib/utils"
import { Marquee } from "@workspace/ui/components/magicui/marquee"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"

const reviews = [
  {
    name: "Michael",
    username: "@michael",
    body: "Detect AI is fast and accurate. I use it every day!",
    img: "https://avatar.vercel.sh/michael",
  },
  {
    name: "Sophia",
    username: "@sophia",
    body: "I tested many AI detection tools, but this one actually works.",
    img: "https://avatar.vercel.sh/sophia",
  },
  {
    name: "David",
    username: "@david",
    body: "Super useful! It makes checking AI-generated text effortless.",
    img: "https://avatar.vercel.sh/david",
  },
  {
    name: "Emily",
    username: "@emily",
    body: "This tool is a lifesaver for my work. It helps me spot AI-generated content instantly.",
    img: "https://avatar.vercel.sh/emily",
  },
  {
    name: "Alex",
    username: "@alex",
    body: "It's incredibly accurate and fast, making AI detection easier than ever!",
    img: "https://avatar.vercel.sh/alex",
  },
  {
    name: "Olivia",
    username: "@olivia",
    body: "Simple, reliable, and surprisingly effective. I highly recommend it!",
    img: "https://avatar.vercel.sh/olivia",
  },
]

const ReviewCard = ({
  img,
  name,
  username,
  body,
  index,
}: {
  img: string
  name: string
  username: string
  body: string
  index: number
}) => {
  const { theme } = useTheme()

  return (
    <motion.figure
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      whileHover={{
        scale: 1.03,
        boxShadow:
          theme === "dark" ? "0 10px 30px -15px rgba(0, 0, 255, 0.3)" : "0 10px 30px -15px rgba(0, 0, 200, 0.2)",
      }}
      className={cn(
        "relative h-full w-64 cursor-pointer overflow-hidden rounded-xl border p-4 transition-all duration-300",
        theme === "dark"
          ? "border-white/10 bg-black/50 backdrop-blur-sm hover:bg-black/60"
          : "border-black/10 bg-white/70 backdrop-blur-sm hover:bg-white/80",
      )}
    >
      <div className="flex flex-row items-center gap-2">
        <motion.img
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, delay: index * 0.1 + 0.2 }}
          className="rounded-full"
          width="32"
          height="32"
          alt={`${name}'s avatar`}
          src={img}
        />
        <div className="flex flex-col">
          <motion.figcaption
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 + 0.3 }}
            className={cn("text-sm font-medium", theme === "dark" ? "text-white" : "text-gray-900")}
          >
            {name}
          </motion.figcaption>
          <motion.p
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 + 0.4 }}
            className={cn("text-xs font-medium", theme === "dark" ? "text-white/40" : "text-gray-500")}
          >
            {username}
          </motion.p>
        </div>
      </div>
      <motion.blockquote
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: index * 0.1 + 0.5 }}
        className={cn("mt-2 text-sm", theme === "dark" ? "text-gray-300" : "text-gray-700")}
      >
        {body}
      </motion.blockquote>

      <motion.div
        initial={{ width: "0%" }}
        animate={{ width: "100%" }}
        transition={{ duration: 1, delay: index * 0.1 + 0.6 }}
        className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500"
      />
    </motion.figure>
  )
}

const firstRow = reviews.slice(0, reviews.length / 2)
const secondRow = reviews.slice(reviews.length / 2)

export const Testimonials = () => {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <section
      id="testimonials"
      className="relative w-full flex flex-col items-center justify-center py-12 mb-10 overflow-hidden px-6 xs:px-8 sm:px-0 sm:x-8 lg:mx-auto transition-colors duration-300"
    >
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="group relative mx-auto flex items-center justify-center rounded-full px-4 py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] transition-shadow duration-500 ease-out hover:shadow-[inset_0_-5px_10px_#8fdfff3f]"
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
          ⭐
        </motion.span>
        <AnimatedGradientText className="text-sm font-medium">Testimonials</AnimatedGradientText>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.2 }}
        className={cn(
          "text-3xl sm:text-4xl font-bold tracking-tight mt-4 text-center",
          theme === "dark"
            ? "bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-white bg-[length:200%_100%]"
            : "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900 bg-[length:200%_100%]",
        )}
        style={{
          backgroundPosition: "0% 0%",
          animation: "gradientMove 5s linear infinite",
        }}
      >
        What Our Users Say
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.3 }}
        className={cn(
          "seriffont1 max-w-3xl mt-4 text-center text-base",
          theme === "dark" ? "text-neutral-300" : "text-neutral-600",
        )}
      >
        See what our users have to say about Detect AI! <br/> Read their experiences and discover how Detect AI can benefit
        you.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.5 }}
        className="relative flex w-full flex-col items-center justify-center overflow-hidden mt-10"
      >
        <Marquee pauseOnHover className="[--duration:20s]">
          {firstRow.map((review, index) => (
            <ReviewCard key={review.username} {...review} index={index} />
          ))}
        </Marquee>
        <div className="h-4"></div>
        <Marquee reverse pauseOnHover className="[--duration:20s]">
          {secondRow.map((review, index) => (
            <ReviewCard key={review.username} {...review} index={index + firstRow.length} />
          ))}
        </Marquee>

        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-background to-transparent"></div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-background to-transparent"></div>
      </motion.div>

      <div className="absolute inset-0 -z-10 overflow-hidden opacity-20 pointer-events-none">
        <motion.div
          className={cn(
            "absolute top-1/4 -left-32 w-64 h-64 rounded-full blur-3xl",
            theme === "dark" ? "bg-purple-600/20" : "bg-purple-400/20",
          )}
          animate={{
            x: [0, 30, 0],
            y: [0, 20, 0],
          }}
          transition={{
            duration: 15,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className={cn(
            "absolute bottom-1/4 -right-32 w-64 h-64 rounded-full blur-3xl",
            theme === "dark" ? "bg-blue-600/20" : "bg-blue-400/20",
          )}
          animate={{
            x: [0, -30, 0],
            y: [0, -20, 0],
          }}
          transition={{
            duration: 18,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </div>
    </section>
  )
}