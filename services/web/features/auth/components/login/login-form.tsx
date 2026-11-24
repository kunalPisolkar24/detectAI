"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Mail } from "lucide-react"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { AuthCard } from "@/features/auth/components/auth-card"
import { TurnstileField } from "@/features/auth/components/turnstile-field"
import { AUTH_COPY } from "@/features/auth/constants"
import { useTurnstile } from "@/features/auth/hooks/use-turnstile"
import { LoginSchema, type LoginValues } from "@/features/auth/schemas/auth"

export function LoginForm() {
  const [rememberMe, setRememberMe] = useState(false)
  const turnstile = useTurnstile()
  const form = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onBlur",
  })
  const { isValid, isSubmitting } = form.formState

  return (
    <AuthCard
      label={AUTH_COPY.login.label}
      title={AUTH_COPY.login.title}
      backHref={AUTH_COPY.login.backHref}
      backLabel={AUTH_COPY.login.backLabel}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(() => undefined)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{AUTH_COPY.fields.email.label}</FormLabel>
                <div className="relative pl-9">
                  <Mail
                    className="absolute top-2.5 left-3 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      autoComplete="email"
                      placeholder={AUTH_COPY.fields.email.placeholder}
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
                <FormLabel>{AUTH_COPY.fields.password.label}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoComplete="current-password"
                    placeholder={AUTH_COPY.fields.password.placeholder}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked === true)}
            />
            <Label htmlFor="remember">{AUTH_COPY.fields.rememberMe}</Label>
          </div>
          <div className="flex justify-center pt-2">
            <TurnstileField turnstile={turnstile} />
          </div>
          <Button
            type="submit"
            variant="brand"
            size="lg"
            disabled={isSubmitting || !isValid || !turnstile.token}
            className="w-full"
          >
            {isSubmitting ? AUTH_COPY.login.submitting : AUTH_COPY.login.submit}
          </Button>
        </form>
      </Form>
    </AuthCard>
  )
}
