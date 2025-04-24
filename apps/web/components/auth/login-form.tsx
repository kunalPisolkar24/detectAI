"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import type { z } from "zod";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { cn } from "@workspace/ui/lib/utils";
import { CardWrapper } from "./card-wrapper";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@workspace/ui/components/form";
import { Input } from "@workspace/ui/components/input";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { LoginSchema } from "@/schemas";
import { TurnstileComponent } from "@/components/common";
import { Eye, EyeOff, Mail, Lock, AlertCircle } from "lucide-react";
import Link from "next/link";

export const LoginForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams(); 
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);


  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    const error = searchParams.get('error');
    if (error === 'CredentialsSignin') {
      setFormError("Invalid email or password");
      setTurnstileToken(null);
      setTurnstileKey(prevKey => prevKey + 1); 
      router.replace('/login', { scroll: false });
    }

    const rememberedEmail = localStorage.getItem("rememberEmail");
    if (rememberedEmail) {
      form.setValue("email", rememberedEmail);
      setRememberMe(true);
    }
  }, [searchParams, form, router]);


  const handleTurnstileVerify = (token: string) => {
    setTurnstileToken(token);
    setFormError(null); 
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const onSubmit = async (data: z.infer<typeof LoginSchema>) => {
    setLoading(true);
    setFormError(null);

    try {
      if (!turnstileToken) {
        setFormError("Please complete human verification");
        toast.error("Please complete human verification");
        setLoading(false);
        return;
      }

      const verifyResponse = await fetch("/api/verify-turnstile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: turnstileToken }),
      });

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json();
        setFormError(errorData.error || "Verification failed");
        toast.error(errorData.error || "Turnstile verification failed");
        setTurnstileToken(null);
        setTurnstileKey(prevKey => prevKey + 1); 
        setLoading(false);
        return;
      }

      const result = await signIn("credentials", {
        callbackUrl: "/chat?login_success=true", 
        email: data.email,
        password: data.password,
        redirect: true,
      });

      if (result?.error) {
        setFormError("An unexpected error occurred during sign in.");
        toast.error("Login failed unexpectedly");
        setTurnstileToken(null);
        setTurnstileKey(prevKey => prevKey + 1);
        setLoading(false);
        return;
      }

      if (rememberMe) {
        localStorage.setItem("rememberEmail", data.email);
      } else {
        localStorage.removeItem("rememberEmail");
      }

    } catch (error: any) {
      setFormError(error.message || "Login failed due to an unexpected error.");
      toast.error(error.message || "Login failed");
      setTurnstileToken(null);
      setTurnstileKey(prevKey => prevKey + 1); 
      setLoading(false);
    }
  };


  return (
    <CardWrapper
      label="Sign In"
      title="Welcome Back"
      backButtonHref="/signup"
      backButtonLabel="Don't have an account? Sign up here."
    >
      <Form {...form}>
        <motion.form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {formError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "p-3 rounded-md flex items-center gap-2 text-sm",
                theme === "dark"
                  ? "bg-red-900/30 text-red-300 border border-red-800/60"
                  : "bg-red-100 text-red-700 border border-red-300",
              )}
            >
              <AlertCircle size={16} />
              {formError}
            </motion.div>
          )}

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={cn(
                  "flex items-center gap-1.5 text-sm",
                   theme === "dark" ? "text-neutral-300" : "text-neutral-700"
                   )}>
                  <Mail size={14} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
                  Email
                </FormLabel>
                <FormControl>
                   <Input
                      {...field}
                      type="email"
                      placeholder="you@example.com"
                      className={cn(
                        "pl-3 pr-3 py-2.5 h-11 text-sm",
                        theme === "dark"
                          ? "bg-zinc-950/60 border-white/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                          : "bg-white border-black/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30",
                        "transition-colors duration-200"
                      )}
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
                 <FormLabel className={cn(
                  "flex items-center gap-1.5 text-sm",
                   theme === "dark" ? "text-neutral-300" : "text-neutral-700"
                   )}>
                  <Lock size={14} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
                  Password
                </FormLabel>
                <FormControl>
                  <div className="relative flex items-center">
                    <Input
                      {...field}
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className={cn(
                        "pl-3 pr-10 py-2.5 h-11 w-full text-sm",
                         theme === "dark"
                          ? "bg-zinc-950/60 border-white/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                          : "bg-white border-black/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30",
                         "transition-colors duration-200"
                      )}
                    />
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.1, opacity: 1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={togglePasswordVisibility}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 opacity-70 transition-opacity"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </motion.button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 pt-1">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
                className={cn(
                  "transition-colors duration-200",
                  theme === "dark"
                    ? "border-white/30 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-500"
                    : "border-black/30 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-500",
                )}
              />
              <label
                htmlFor="remember"
                className="text-xs sm:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Remember me
              </label>
            </div>

            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Link
                href="/forgot-password"
                className={cn(
                  "text-xs sm:text-sm transition-colors duration-150",
                  theme === "dark" ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
                )}
              >
                Forgot password?
              </Link>
            </motion.div>
          </div>

          <motion.div
            className="flex justify-center py-4"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <TurnstileComponent
              key={turnstileKey} 
              siteKey="0x4AAAAAABA_xFDZEVC1Iru5"
              onVerify={handleTurnstileVerify}
              onError={(error: any) => {
                console.error("Turnstile error:", error);
                setFormError("Verification error. Please try again.");
                toast.error("Verification Error");
                setTurnstileKey(prevKey => prevKey + 1); 
              }}
            />
          </motion.div>

          <motion.div whileHover={{ scale: 1.02, y: -1 }} whileTap={{ scale: 0.98 }}>
            <Button
              type="submit"
              className={cn(
                "w-full py-3 text-sm sm:text-base font-semibold transition-all duration-300",
                theme === "dark"
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white border-0 shadow-md hover:shadow-lg hover:shadow-blue-500/20 dark:hover:shadow-purple-600/20"
                  : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0 shadow-md hover:shadow-lg hover:shadow-blue-500/30",
              )}
              disabled={loading || !turnstileToken}
            >
              {loading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                  className="mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full inline-block" 
                />
              ) : null}
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </motion.div>
        </motion.form>
      </Form>
    </CardWrapper>
  );
};