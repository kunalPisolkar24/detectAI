"use client"

import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { m } from "framer-motion"
import { Eye, EyeOff, User, Mail, Lock, AlertCircle } from "lucide-react"
import type { z } from "zod"

import { cn } from "@/lib/core/utils"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SignupSchema } from "@/schemas/auth"
import { TurnstileComponent } from "./turnstile"
import { CardWrapper } from "./card-wrapper"
import { teko } from "@/lib/core/fonts"
import { useTurnstile } from "@/features/auth/hooks/use-turnstile"
import { registerAction } from "@/features/auth/actions/register"

export const SignupForm = () => {
  const [isPending, startTransition] = useTransition()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    token,
    key,
    siteKey,
    isConfigured,
    errorMessage,
    onVerify,
    onError,
    onExpire,
    onTimeout,
    reset,
  } = useTurnstile()

  const form = useForm<z.infer<typeof SignupSchema>>({
    resolver: zodResolver(SignupSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      confirmPassword: "",
    },
  })

  const onSubmit = (data: z.infer<typeof SignupSchema>) => {
    setFormError(null)

    if (!token) {
      setFormError("Please complete human verification")
      return
    }

    startTransition(async () => {
      const result = await registerAction(data, token)

      if (result.error) {
        setFormError(result.error)
        reset() 
        return
      }

      try {
        const signInResult = await signIn("credentials", {
          email: data.email,
          password: data.password,
          callbackUrl: "/chat?login_success=true",
        })

        if (signInResult?.error) {
          setFormError("Account created, but auto-login failed.")
        }
      } catch {
        setFormError("Something went wrong during sign in.")
      }
    })
  }

  return (
    <CardWrapper
      label="Create Account"
      title="Get Started"
      backButtonHref="/login"
      backButtonLabel="Already have an account? Login here."
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

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="John"
                        className="pl-9 bg-background/50 border-black/10 dark:border-white/10"
                        disabled={isPending}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Name</FormLabel>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Doe"
                        className="pl-9 bg-background/50 border-black/10 dark:border-white/10"
                        disabled={isPending}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="john@example.com"
                      className="pl-9 bg-background/50 border-black/10 dark:border-white/10"
                      disabled={isPending}
                    />
                  </FormControl>
                </div>
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
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <FormControl>
                    <Input
                      {...field}
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-9 pr-10 bg-background/50 border-black/10 dark:border-white/10"
                      disabled={isPending}
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                    disabled={isPending}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm Password</FormLabel>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <FormControl>
                    <Input
                      {...field}
                      type={showConfirm ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-9 pr-10 bg-background/50 border-black/10 dark:border-white/10"
                      disabled={isPending}
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                    disabled={isPending}
                    aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-center pt-2">
            <div className="flex w-full flex-col items-center gap-3">
              {isConfigured ? (
                <TurnstileComponent
                  key={key}
                  siteKey={siteKey}
                  onVerify={onVerify}
                  onError={onError}
                  onExpire={onExpire}
                  onTimeout={onTimeout}
                />
              ) : (
                <div className="w-full rounded-md border border-destructive/20 bg-destructive/15 px-4 py-3 text-center text-sm text-destructive">
                  {errorMessage}
                </div>
              )}

              {errorMessage && isConfigured ? (
                <div className="flex w-full flex-col items-center gap-2">
                  <p className="text-center text-sm text-destructive">
                    {errorMessage}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFormError(null)
                      reset()
                    }}
                    disabled={isPending}
                  >
                    Retry verification
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <Button
            type="submit"
            className={cn(
              "w-full text-lg tracking-wide bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0 shadow-lg",
              teko.className
            )}
            disabled={isPending || !token}
          >
            {isPending ? "Creating Account..." : "CREATE ACCOUNT"}
          </Button>
        </form>
      </Form>
    </CardWrapper>
  )
}
