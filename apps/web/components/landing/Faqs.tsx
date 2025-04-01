"use client"
import { useState, useEffect } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/ui/components/accordion"
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"

const faqsList = [
  {
    question: "What is Detect AI?",
    answer: "Detect AI is a tool that helps identify whether a piece of text is AI-generated or human-written.",
  },
  {
    question: "How accurate is Detect AI?",
    answer: "Detect AI uses advanced models like SNN and BERT to ensure high accuracy in AI text detection.",
  },
  {
    question: "Is Detect AI free to use?",
    answer:
      "Yes! We offer a free plan with basic detection features, while the premium plan provides advanced analysis.",
  },
  {
    question: "Can Detect AI detect mixed AI and human-written content?",
    answer: "Yes, it can analyze hybrid content and highlight AI-generated sections.",
  },
  {
    question: "Do I need an account to use Detect AI?",
    answer:
      "No, you can use the free version without an account. However, creating an account unlocks additional features.",
  },
  {
    question: "How does Detect AI handle user data?",
    answer: "We prioritize privacy and do not store or share any text submitted for analysis.",
  },
]

const Question = ({ question, answer, index }: { question: string; answer: string; index: number }) => {
  const { theme } = useTheme()

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 + index * 0.08 }}
    >
      <AccordionItem
        value={question}
        className={cn(
          "border rounded-lg mb-3 overflow-hidden transition-colors duration-300",
          theme === "dark"
            ? "border-white/10 bg-black/50 backdrop-blur-sm hover:bg-black/60"
            : "border-black/10 bg-white/70 backdrop-blur-sm hover:bg-white/80",
        )}
      >
        <AccordionTrigger
          className={cn(
            "text-left px-4 py-3 font-medium text-xs sm:text-sm md:text-base hover:no-underline", // Responsive text size
            theme === "dark" ? "text-white hover:text-neutral-200" : "text-gray-800 hover:text-gray-950",
          )}
        >
          {question}
        </AccordionTrigger>
        <AccordionContent
          className={cn("px-4 pb-3 sm:pb-4 text-xs sm:text-sm md:text-base seriffont1", // Responsive text size and padding bottom
          theme === "dark" ? "text-neutral-300" : "text-neutral-600")}
        >
          {answer}
        </AccordionContent>
      </AccordionItem>
    </motion.div>
  )
}

export const Faqs = () => {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <section
      id="faqs"
      className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-background text-foreground transition-colors duration-300 py-16 md:py-24 px-4 sm:px-6 lg:px-8" // Added padding here
    >
      {/* --- Responsive Animated Background Elements --- */}
      <div className="absolute inset-0 -z-10 overflow-hidden opacity-15 sm:opacity-20 pointer-events-none"> {/* Reduced opacity slightly on mobile */}
        <motion.div
          className={cn(
            "absolute top-1/4 -left-24 w-72 h-72 sm:w-[500px] sm:h-[500px] sm:-left-40 rounded-full blur-3xl", // Smaller size/position on mobile
            theme === "dark" ? "bg-purple-600/20" : "bg-purple-400/20",
          )}
          animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
          transition={{ duration: 20, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <motion.div
          className={cn(
            "absolute bottom-1/4 -right-24 w-72 h-72 sm:w-[500px] sm:h-[500px] sm:-right-40 rounded-full blur-3xl", // Smaller size/position on mobile
            theme === "dark" ? "bg-blue-600/20" : "bg-blue-400/20",
          )}
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
          transition={{ duration: 23, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
      </div>

      {/* --- Badge --- */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="group relative mx-auto flex items-center justify-center rounded-full px-3 py-1 sm:px-4 sm:py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] transition-shadow duration-500 ease-out hover:shadow-[inset_0_-5px_10px_#8fdfff3f] mb-4 sm:mb-5" // Responsive padding/margin
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
          className="mr-1.5 sm:mr-2" // Responsive margin
        >
          💬
        </motion.span>
        <AnimatedGradientText className="text-xs sm:text-sm font-medium">FAQs</AnimatedGradientText> {/* Responsive text size */}
      </motion.div>

      {/* --- Responsive Heading --- */}
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1 }}
        className={cn(
          "text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-center", // Responsive text size
          theme === "dark"
            ? "bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-white bg-[length:200%_100%]"
            : "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900 bg-[length:200%_100%]",
        )}
        style={{
          backgroundPosition: "0% 0%",
          animation: "gradientMove 5s linear infinite",
        }}
      >
        Frequently Asked Questions
      </motion.h2>

      {/* --- Responsive Paragraph --- */}
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.2 }}
        className={cn(
          "max-w-xl md:max-w-2xl mx-auto mt-2 sm:mt-3 md:mt-4 text-center text-xs sm:text-sm md:text-base seriffont1", // Responsive max-width, margin, text-size
          theme === "dark" ? "text-neutral-300" : "text-neutral-600",
        )}
      >
        Here are some of the most frequently asked questions about our product.
      </motion.p>

      {/* --- Accordion Section --- */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 0.3 }}
        className="w-full max-w-3xl mx-auto mt-8 sm:mt-10 md:mt-12" // Responsive margin
      >
        <Accordion type="single" collapsible className="w-full">
          {faqsList.map((faq, index) => (
            <Question key={faq.question} question={faq.question} answer={faq.answer} index={index} />
          ))}
        </Accordion>
      </motion.div>

      {/* --- Responsive CTA Section --- */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.5 + faqsList.length * 0.08 }}
        className={cn(
          "mt-12 sm:mt-16 text-center p-4 sm:p-6 rounded-xl w-full max-w-2xl mx-auto", // Responsive margin, padding
          theme === "dark"
            ? "bg-black/40 border border-white/10 backdrop-blur-sm"
            : "bg-white/60 border border-black/10 backdrop-blur-sm",
        )}
      >
        <h3 className={cn("text-sm sm:text-base md:text-lg font-semibold mb-1 sm:mb-2", // Responsive text size, margin
        theme === "dark" ? "text-white" : "text-gray-900")}>
          Still have questions?
        </h3>
        <p className={cn("text-xs sm:text-sm md:text-base", // Responsive text size
        theme === "dark" ? "text-neutral-300" : "text-neutral-600")}>
          If you couldn't find the answer to your question, feel free to reach out to our support team.
        </p>
        <motion.a
          href="/contact"
          whileHover={{ scale: 1.05, filter: theme === 'dark' ? 'brightness(1.1)' : 'brightness(1.05)'}}
          whileTap={{ scale: 0.97 }}
          className={cn(
            "inline-block mt-3 sm:mt-4 px-4 py-1.5 sm:px-5 sm:py-2 rounded-md font-medium text-xs sm:text-sm transition-all duration-200", // Responsive margin, padding, text size
            theme === "dark"
              ? "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/40"
              : "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-300/50",
          )}
        >
          Contact Support
        </motion.a>
      </motion.div>
    </section>
  )
}