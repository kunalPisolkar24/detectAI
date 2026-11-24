"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  AtSignIcon,
  SquareUnlock02Icon,
  UserIcon,
} from "@hugeicons/core-free-icons"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { AuthCard } from "@/features/auth/components/auth-card"
import { TurnstileField } from "@/features/auth/components/turnstile-field"
import { AUTH_COPY } from "@/features/auth/constants"
import { useTurnstile } from "@/features/auth/hooks/use-turnstile"
import { SignupSchema, type SignupValues } from "@/features/auth/schemas/auth"

export function SignupForm() {
  const turnstile = useTurnstile()
  const form = useForm<SignupValues>({
    resolver: zodResolver(SignupSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      confirmPassword: "",
    },
    mode: "onBlur",
  })
  const { isValid, isSubmitting } = form.formState

  return (
    <AuthCard
      label={AUTH_COPY.signup.label}
      title={AUTH_COPY.signup.title}
      backHref={AUTH_COPY.signup.backHref}
      backLabel={AUTH_COPY.signup.backLabel}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(() => undefined)} className="space-y-4">
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{AUTH_COPY.fields.firstName.label}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      icon={UserIcon}
                      autoComplete="given-name"
                      placeholder={AUTH_COPY.fields.firstName.placeholder}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{AUTH_COPY.fields.lastName.label}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      icon={UserIcon}
                      autoComplete="family-name"
                      placeholder={AUTH_COPY.fields.lastName.placeholder}
                    />
                  </FormControl>
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
                <FormLabel>{AUTH_COPY.fields.email.label}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    icon={AtSignIcon}
                    type="email"
                    autoComplete="email"
                    placeholder={AUTH_COPY.fields.email.placeholder}
                  />
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
                <FormLabel>{AUTH_COPY.fields.password.label}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    icon={SquareUnlock02Icon}
                    autoComplete="new-password"
                    placeholder={AUTH_COPY.fields.password.placeholder}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{AUTH_COPY.fields.confirmPassword.label}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    icon={SquareUnlock02Icon}
                    autoComplete="new-password"
                    placeholder={AUTH_COPY.fields.confirmPassword.placeholder}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-center pt-2">
            <TurnstileField turnstile={turnstile} />
          </div>
          <Button
            type="submit"
            variant="brand"
            size="cta-sm"
            disabled={isSubmitting || !isValid || !turnstile.token}
            className="w-full"
          >
            {isSubmitting ? AUTH_COPY.signup.submitting : AUTH_COPY.signup.submit}
          </Button>
        </form>
      </Form>
    </AuthCard>
  )
}
