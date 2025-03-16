"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { LoginSchema } from "@/schemas";
import { TurnstileComponent } from "@/components/common";

export const LoginForm = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const form = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const handleTurnstileVerify = (token: string) => {
    setTurnstileToken(token);
  };

  const onSubmit = async (data: z.infer<typeof LoginSchema>) => {
    setLoading(true);
    try {
      if (!turnstileToken) {
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
        toast.error(errorData.error || "Turnstile verification failed");
        setLoading(false);
        return;
      }

      const result = await signIn("credentials", {
        redirect: false,
        email: data.email,
        password: data.password,
      });

      if (result?.error) {
        toast.error("Invalid credentials");
        return;
      }

      toast.success("Login successful!");
      router.push("/chat");
    } catch (error: any) {
      toast.error(error.message || "Login failed");
    } finally {
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
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input {...field} type="email" placeholder="you@example.com" />
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
                  <Input {...field} type="password" placeholder="******" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {/* Centered Turnstile Component */}
          <div className="flex justify-center pt-4">
            <TurnstileComponent
              siteKey="0x4AAAAAABA_xFDZEVC1Iru5"
              onVerify={handleTurnstileVerify}
              onError={(error: any) => {
                console.error("Turnstile error:", error);
                toast.error("Verification Error");
              }}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Loading..." : "Login"}
          </Button>
        </form>
      </Form>
    </CardWrapper>
  );
};
