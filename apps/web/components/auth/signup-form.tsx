"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { cn } from "@workspace/ui/lib/utils";
import { CardWrapper } from "./card-wrapper";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/ui/components/form";
import { Input } from "@workspace/ui/components/input";
import { Button } from "@workspace/ui/components/button";
import { SignupSchema } from "@/schemas/auth-schema";
import { TurnstileComponent } from "@/components/common";
import { Eye, EyeOff, User, Mail, Lock, AlertCircle } from "lucide-react";

export const SignupForm = () => {
  const router = useRouter(); // Keep router for potential future use, but not for post-signup redirect
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof SignupSchema>>({
    resolver: zodResolver(SignupSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      confirmPassword: "",
    },
  });

  const handleTurnstileVerify = (token: string) => {
    setTurnstileToken(token);
    setFormError(null);
  };

  const togglePasswordVisibility = () => setShowPassword(!showPassword);
  const toggleConfirmPasswordVisibility = () => setShowConfirmPassword(!showConfirmPassword);

  const onSubmit = async (data: z.infer<typeof SignupSchema>) => {
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
        const errorMsg = errorData.error || "Turnstile verification failed";
        setFormError(errorMsg);
        toast.error(errorMsg);
        setTurnstileToken(null);
        setLoading(false);
        return;
      }

      const registerResponse = await fetch("/api/auth/register", { // Ensure this path is correct
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          firstName: data.firstName,
          lastName: data.lastName,
          name: `${data.firstName} ${data.lastName}`, // Ensure your API route expects this
        }),
      });

      const registerResult = await registerResponse.json();

      if (!registerResponse.ok) {
        const errorMsg = registerResult.error || "Registration failed";
        setFormError(errorMsg);
        toast.error(errorMsg);
        setTurnstileToken(null); // Require re-verify on registration error
        setLoading(false);
        return;
      }

      // Directly sign in after successful registration, letting NextAuth handle the redirect
      const signInResult = await signIn("credentials", {
        email: data.email,
        password: data.password,
        callbackUrl: "/chat?login_success=true", // Redirect to chat on success, trigger toast there
        // redirect: true is the default, so no need to specify
      });

      // This part will likely only be reached if signIn itself fails *after* registration
      if (signInResult?.error) {
         // Differentiate sign-in error from registration error
         if (signInResult.error === 'CredentialsSignin') {
            setFormError("Sign in failed after registration. Please try logging in manually.");
            toast.error("Sign in failed. Please log in.");
            // Maybe redirect to login page?
            // router.push('/login');
         } else {
            setFormError(signInResult.error);
            toast.error(signInResult.error);
         }
        setTurnstileToken(null); // Re-verify needed potentially
        setLoading(false);
        return;
      }

      // If signIn initiates a successful redirect, the code below might not execute.
      // The success toast is now handled on the /chat page via the callbackUrl parameter.
      // toast.success("Signup successful! Redirecting..."); // Remove this
      // Remove the setTimeout and router.push
      // setTimeout(() => {
      //   router.push("/chat");
      // }, 5000);

      // setLoading(false); // Might not be needed if page navigates away

    } catch (error: any) {
        const errorMsg = error.message || "An unexpected error occurred during signup";
        setFormError(errorMsg);
        toast.error(errorMsg);
        setTurnstileToken(null);
        setLoading(false);
    }
  };

  return (
    <CardWrapper
      label="Create a new account"
      title="Get Started"
      backButtonHref="/login"
      backButtonLabel="Already have an account? Login here."
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

          <div className="flex flex-col sm:flex-row gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem className="w-full sm:w-1/2">
                  <FormLabel className={cn("flex items-center gap-1.5 text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-700")}>
                    <User size={14} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
                    First Name
                  </FormLabel>
                  <FormControl>
                    <Input
                       {...field}
                       placeholder="Bhaskar"
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
              name="lastName"
              render={({ field }) => (
                <FormItem className="w-full sm:w-1/2">
                   <FormLabel className={cn("flex items-center gap-1.5 text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-700")}>
                      <User size={14} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
                      Last Name
                    </FormLabel>
                  <FormControl>
                     <Input
                       {...field}
                       placeholder="Prajapati"
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
          </div>

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={cn("flex items-center gap-1.5 text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-700")}>
                    <Mail size={14} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
                    Email
                </FormLabel>
                <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="bhaskarprajapati@gmail.com"
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
                  <FormLabel className={cn("flex items-center gap-1.5 text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-700")}>
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
                        whileHover={{ scale: 1.1, opacity: 1 }} whileTap={{ scale: 0.9 }}
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

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                  <FormLabel className={cn("flex items-center gap-1.5 text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-700")}>
                      <Lock size={14} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
                      Confirm Password
                  </FormLabel>
                <FormControl>
                  <div className="relative flex items-center">
                    <Input
                        {...field}
                        type={showConfirmPassword ? "text" : "password"}
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
                        whileHover={{ scale: 1.1, opacity: 1 }} whileTap={{ scale: 0.9 }}
                        onClick={toggleConfirmPasswordVisibility}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 opacity-70 transition-opacity"
                        aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                      >
                        {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </motion.button>
                   </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <motion.div
            className="flex justify-center py-4"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <TurnstileComponent
               siteKey="0x4AAAAAABA_xFDZEVC1Iru5" // Replace with your actual site key
               onVerify={handleTurnstileVerify}
               onError={(error: any) => {
                 console.error("Turnstile error:", error);
                 setFormError("Verification error. Please try again.");
                 toast.error("Verification Error");
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
              {loading ? "Creating Account..." : "Create Account"}
            </Button>
          </motion.div>
        </motion.form>
      </Form>
    </CardWrapper>
  );
};