"use client"

import { ReactNode } from "react"
import { m } from "framer-motion"
import { FaGoogle, FaGithub } from "react-icons/fa"
import { signIn } from "next-auth/react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AuthHeader } from "./auth-header"
import { BackButton } from "./back-button"

interface CardWrapperProps {
  children: ReactNode
  label: string
  title: string
  backButtonHref: string
  backButtonLabel: string
  showSocial?: boolean
}

export const CardWrapper = ({
  label,
  title,
  backButtonHref,
  backButtonLabel,
  children,
  showSocial = true
}: CardWrapperProps) => {
  return (
    <m.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full"
    >
      <Card className={cn(
        "w-full border shadow-xl backdrop-blur-md transition-all duration-300",
        "bg-white/70 border-black/10",
        "dark:bg-black/50 dark:border-white/10"
      )}>
        <CardHeader className="space-y-1">
          <AuthHeader label={label} title={title} />
        </CardHeader>

        <CardContent className="space-y-6">
          {showSocial && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  onClick={() => signIn("google", { callbackUrl: "/chat" })}
                  className="w-full bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <FaGoogle className="mr-2 h-4 w-4" />
                  Google
                </Button>
                <Button
                  variant="outline"
                  onClick={() => signIn("github", { callbackUrl: "/chat" })}
                  className="w-full bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <FaGithub className="mr-2 h-4 w-4" />
                  Github
                </Button>
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-black/10 dark:border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    Or continue with
                  </span>
                </div>
              </div>
            </div>
          )}
          {children}
        </CardContent>

        <CardFooter>
          <BackButton label={backButtonLabel} href={backButtonHref} />
        </CardFooter>
      </Card>
    </m.div>
  )
}