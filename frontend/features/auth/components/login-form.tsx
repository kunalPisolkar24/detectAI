"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { toast } from "sonner"
import { m } from "framer-motion"
import { Eye, EyeOff, Mail, Lock, AlertCircle } from "lucide-react"
import Link from "next/link"
import type { z } from "zod"

import { cn } from "@/lib/utils"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { LoginSchema } from "@/schemas/auth"
import { TurnstileComponent } from "./turnstile"
import { CardWrapper } from "./card-wrapper"
import { teko } from "@/lib/fonts"
import { verifyTurnstileToken } from "@/features/auth/services/auth"
import { useTurnstile } from "@/features/auth/hooks/use-turnstile"

export const LoginForm = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  
  const { token, key, onVerify, reset, siteKey } = useTurnstile()

  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  useEffect(() => {
    const error = searchParams.get("error")
    if (error === "CredentialsSignin") {
      setFormError("Invalid email or password")
      reset()
      router.replace("/login", { scroll: false })
    }

    const rememberedEmail = localStorage.getItem("rememberEmail")
    if (rememberedEmail) {
      form.setValue("email", rememberedEmail)
      setRememberMe(true)
    }
  }, [searchParams, form, router, reset])

  const onSubmit = async (data: z.infer<typeof LoginSchema>) => {
    setLoading(true)
    setFormError(null)

    try {
      if (!token) {
        throw new Error("Please complete human verification")
      }

      await verifyTurnstileToken(token)

      const result = await signIn("credentials", {
        callbackUrl: "/chat?login_success=true",
        email: data.email,
        password: data.password,
        redirect: true,
      })

      if (result?.error) {
        throw new Error("An unexpected error occurred during sign in.")
      }

      if (rememberMe) {
        localStorage.setItem("rememberEmail", data.email)
      } else {
        localStorage.removeItem("rememberEmail")
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Login failed"
      setFormError(msg)
      toast.error(msg)
      reset()
      setLoading(false)
    }
  }

  return (
    <CardWrapper
      label="Sign In"
      title="Welcome Back"
      backButtonHref="/signup"
      backButtonLabel="Don't have an account? Sign up here."
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {formError && (
            <m.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-md flex items-center gap-2 text-sm bg-destructive/15 text-destructive border border-destructive/20"
            >
              <AlertCircle size={16} />
              {formError}
            </m.div>
          )}

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      {...field}
                      type="email"
                      placeholder="you@example.com"
                      className="pl-9 bg-background/50 border-black/10 dark:border-white/10"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      {...field}
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-9 pr-10 bg-background/50 border-black/10 dark:border-white/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
              />
              <label
                htmlFor="remember"
                className="font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Remember me
              </label>
            </div>
            <Link
              href="/forgot-password"
              className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
            >
              Forgot password?
            </Link>
          </div>

          <div className="flex justify-center pt-2">
            <TurnstileComponent
              key={key}
              siteKey={siteKey}
              onVerify={onVerify}
              onError={() => {
                setFormError("Verification error. Please try again.")
                reset()
              }}
            />
          </div>

          <Button
            type="submit"
            className={cn(
              "w-full text-lg tracking-wide bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0 shadow-lg",
              teko.className
            )}
            disabled={loading || !token}
          >
            {loading ? "Signing in..." : "SIGN IN"}
          </Button>
        </form>
      </Form>
    </CardWrapper>
  )
}