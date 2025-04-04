"use client"
import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import Image from "next/image"
import { motion } from "framer-motion"
import { FaGoogle, FaGithub } from "react-icons/fa"
import { signIn } from "next-auth/react"
import { cn } from "@workspace/ui/lib/utils"
import { Card, CardContent, CardHeader, CardFooter } from "@workspace/ui/components/card"
import { AuthHeader } from "./auth-header"
import { BackButton } from "./back-button"
import { Button } from "@workspace/ui/components/button"
import AuthImg from "@/public/authImage.jpg"
import { Logo } from "@/components/common"

export const CardWrapper = ({ label, title, backButtonHref, backButtonLabel, children }: any) => {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div className="flex min-h-screen">
      {/* Left side - Image and testimonial */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="hidden lg:block w-1/2 relative text-white"
      >
        <div className="w-full h-[40%] bg-gradient-to-t from-transparent to-black/50 absolute top-0 left-0 z-10" />
        <div className="w-full h-[30%] bg-gradient-to-b from-transparent to-black/50 absolute bottom-0 left-0 z-10" />
        <Image src={AuthImg || "/placeholder.svg"} alt="Auth image" fill className="w-full h-full object-cover" />

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="absolute top-10 left-10 z-10"
        >
          <Logo />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="absolute bottom-10 left-10 z-10 w-[90%]"
        >
          <blockquote className="space-y-2">
            <p className="text-lg">
              &ldquo;Using Detect AI has drastically improved our ability to identify AI-generated text, saving us time
              and ensuring the authenticity of our content. It has streamlined our processes, allowing us to focus more
              on delivering valuable, original material to our audience.&rdquo;
            </p>
            <footer className="text-sm">Bhaskar P.</footer>
          </blockquote>
        </motion.div>

        {/* Animated gradient overlay */}
        <div className="absolute inset-0 opacity-30 pointer-events-none z-0">
          <motion.div
            className="absolute top-1/3 -left-32 w-96 h-96 rounded-full blur-3xl bg-purple-600/30"
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
            className="absolute bottom-1/3 -right-32 w-96 h-96 rounded-full blur-3xl bg-blue-600/30"
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
      </motion.div>

      {/* Right side - Login form */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full lg:w-1/2 flex justify-center items-center py-10 px-3 md:px-10"
      >
        <Card
          className={cn(
            "w-full max-w-md transition-all duration-300",
            theme === "dark"
              ? "bg-black/80 border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.3)]"
              : "bg-white border-black/10 shadow-[0_8px_30px_rgb(0,0,0,0.1)]",
          )}
        >
          <CardHeader>
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <AuthHeader label={label} title={title} />
            </motion.div>
          </CardHeader>

          <CardContent>
            <div className="space-y-4">
              {/* Social login buttons */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="flex flex-col sm:flex-row gap-2 w-full"
              >
                <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="w-full">
                  <Button
                    onClick={() => signIn("google", { callbackUrl: "/chat" })}
                    className={cn(
                      "w-full py-6 font-medium flex items-center justify-center gap-2",
                      theme === "dark"
                        ? "bg-white/10 hover:bg-white/20 text-white border border-white/20"
                        : "bg-black/5 hover:bg-black/10 text-black border border-black/10",
                    )}
                    variant="outline"
                  >
                    <FaGoogle size={18} />
                    <span>Google</span>
                  </Button>
                </motion.div>

                <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="w-full">
                  <Button
                    onClick={() => signIn("github", { callbackUrl: "/chat" })}
                    className={cn(
                      "w-full py-6 font-medium flex items-center justify-center gap-2",
                      theme === "dark"
                        ? "bg-white/10 hover:bg-white/20 text-white border border-white/20"
                        : "bg-black/5 hover:bg-black/10 text-black border border-black/10",
                    )}
                    variant="outline"
                  >
                    <FaGithub size={18} />
                    <span>GitHub</span>
                  </Button>
                </motion.div>
              </motion.div>

              {/* Divider */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                className="flex items-center my-6"
              >
                <div
                  className={cn("flex-grow border-t", theme === "dark" ? "border-white/10" : "border-black/10")}
                ></div>
                <span className={cn("px-4 text-sm", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                  or continue with email
                </span>
                <div
                  className={cn("flex-grow border-t", theme === "dark" ? "border-white/10" : "border-black/10")}
                ></div>
              </motion.div>

              {/* Form */}
              {children}
            </div>
          </CardContent>

          <CardFooter>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.7 }}
              className="w-full"
            >
              <BackButton label={backButtonLabel} href={backButtonHref} />
            </motion.div>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  )
}

