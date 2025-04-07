"use client";

import { useState, useEffect } from "react";
import { initializePaddle, Paddle } from '@paddle/paddle-js';
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text";
import { cn } from "@workspace/ui/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { CircleCheck, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react"; // Import useSession

// Price IDs
const PREMIUM_MONTHLY_PRICE_ID = "pri_01jr2gqggwjakpc1hd9xzym7fy";
const PREMIUM_YEARLY_PRICE_ID = "pri_01jr2gs8ckz66srr8sd1byh7n4";

interface PaymentProps {
  onSubscriptionAttempt: () => void;
}

export const Payment: React.FC<PaymentProps> = ({ onSubscriptionAttempt }) => {
  const [billingCycle, setBillingCycle] = useState("monthly");
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [paddle, setPaddle] = useState<Paddle | undefined>();
  const [isPaddleLoading, setIsPaddleLoading] = useState(true);
  const { data: session, status: sessionStatus } : any = useSession(); // Get session data

  useEffect(() => {
    setMounted(true);
    if (process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN) {
      initializePaddle({
        token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
        environment: "sandbox",
        eventCallback: (data) => {
          if (data.name === 'checkout.closed') {
            console.log('Checkout closed by user.');
          }
          if (data.name === 'checkout.completed') {
            console.log('Checkout potentially completed (verify with webhook)');
          }
        }
      })
        .then((paddleInstance: Paddle | undefined) => {
          if (paddleInstance) setPaddle(paddleInstance);
          else console.error("Failed to initialize Paddle.");
          setIsPaddleLoading(false);
        })
        .catch((error) => {
          console.error("Error initializing Paddle:", error);
          setIsPaddleLoading(false);
        });
    } else {
      console.error("Paddle Client Token not found.");
      setIsPaddleLoading(false);
    }
  }, []);

  const handleSubscription = () => {
    if (!paddle) {
      alert("Payment system is initializing, please wait.");
      return;
    }
    // Check if user is authenticated using session status and data
    if (sessionStatus !== 'authenticated' || !session?.user?.email || !session?.user?.id) {
      alert("Please log in to subscribe.");
      // Optionally redirect to login
      // import { useRouter } from 'next/navigation';
      // const router = useRouter();
      // router.push('/login');
      return;
    }

    const priceId = billingCycle === 'monthly'
      ? PREMIUM_MONTHLY_PRICE_ID
      : PREMIUM_YEARLY_PRICE_ID;

    onSubscriptionAttempt();

    paddle.Checkout.open({
      items: [{ priceId: priceId, quantity: 1 }],
      customer: { email: session.user.email }, // Use email from session
      customData: { userId: session.user.id }, // Use ID from session
      settings: { theme: theme === 'dark' ? 'dark' : 'light' }
    });
  };

  const products = [
     {
      id: 1,
      name: "Free",
      priceString: billingCycle === "monthly" ? "₹0" : "₹0",
      billingInterval: billingCycle === "monthly" ? "/month" : "/year",
      description: "Get started with AI detection using the Sequential Model.",
      features: [
        "Sequential Model for AI detection",
        "Limited API calls (100/day)",
        "Basic accuracy level",
        "Community support",
      ],
      buttonText: "Current Plan", // Assuming dialog shown to upgrade
      buttonLink: "/profile", // Link back to profile maybe?
    },
    {
      id: 2,
      name: "Premium",
      priceString: billingCycle === "monthly" ? "₹200" : "₹1000",
      billingInterval: billingCycle === "monthly" ? "/month" : "/year",
      description: "Unlock the full power of AI with the BERT Model.",
      features: [
        "Advanced BERT Model for superior AI detection",
        "Unlimited API calls",
        "High accuracy & deep analysis",
        "Priority customer support",
        "Early access to new features",
      ],
      buttonText: "Upgrade Now",
      buttonAction: handleSubscription,
    },
  ];

  if (!mounted) return null;

  // Combine loading states
  const isLoading = isPaddleLoading || sessionStatus === 'loading';

  return (
    <section className="w-full relative overflow-hidden flex flex-col items-center justify-center bg-transparent text-foreground transition-colors duration-300 py-10 md:py-16">
      <div className="absolute inset-0 opacity-5 pointer-events-none -z-10">
        <div
          className={cn(
            "absolute inset-0 animate-gradient-slow",
            theme === "dark" ? "bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10" : "bg-gradient-to-r from-purple-300/20 via-blue-300/20 to-cyan-300/20"
          )}
        />
        <motion.div
          className={cn("absolute top-1/4 -left-32 w-96 h-96 rounded-full blur-3xl", theme === "dark" ? "bg-purple-600/15" : "bg-purple-400/15")}
          animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
          transition={{ duration: 15, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <motion.div
          className={cn("absolute bottom-1/4 -right-32 w-96 h-96 rounded-full blur-3xl", theme === "dark" ? "bg-blue-600/15" : "bg-blue-400/15")}
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
          transition={{ duration: 18, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
      </div>

      <div className="w-full container px-4 sm:px-6 lg:px-8 mx-auto flex flex-col items-center justify-center space-y-6 z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Tabs
            onValueChange={setBillingCycle}
            defaultValue="monthly"
            className={cn("border p-1 rounded-xl shadow-md", theme === "dark" ? "bg-black/60 backdrop-blur-sm border-white/10" : "bg-white/90 backdrop-blur-sm border-black/10")}
          >
            <TabsList className={cn("grid w-full grid-cols-2 rounded-lg", theme === "dark" ? "bg-black/70" : "bg-gray-100")}>
              <TabsTrigger className="font-semibold data-[state=active]:bg-blue-600/30 data-[state=active]:text-blue-100 dark:data-[state=active]:bg-blue-500/40 dark:data-[state=active]:text-blue-100" value="monthly">
                Monthly
              </TabsTrigger>
              <TabsTrigger className="font-semibold data-[state=active]:bg-blue-600/30 data-[state=active]:text-blue-100 dark:data-[state=active]:bg-blue-500/40 dark:data-[state=active]:text-blue-100" value="yearly">
                Yearly
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 mt-6 w-full">
          {products.map((product, index) => {
            const isPremium = product.name === "Premium";
            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 + index * 0.15 }}
                whileHover={{ y: -3, boxShadow: theme === "dark" ? "0 10px 25px -10px rgba(0, 100, 255, 0.2)" : "0 10px 25px -10px rgba(0, 100, 200, 0.15)" }}
                className={cn(
                  "border rounded-xl h-full w-full flex flex-col justify-between divide-y transition-all duration-300 relative overflow-hidden",
                  theme === "dark" ? (isPremium ? "border-blue-500/50 bg-zinc-900/80 backdrop-blur-sm divide-white/10" : "border-white/10 bg-zinc-950/60 backdrop-blur-sm divide-white/10") : (isPremium ? "border-blue-500/50 bg-white/90 backdrop-blur-sm divide-black/10" : "border-black/10 bg-gray-50/80 backdrop-blur-sm divide-black/10")
                )}
              >
                <div className="p-4 md:p-5 flex-1">
                  <h2 className="text-xl md:text-2xl leading-6 font-semibold flex items-center justify-between">
                    {product.name}
                    {isPremium && (
                      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, delay: 0.4, type: "spring", stiffness: 200 }}>
                        <Badge variant="default" className={cn("font-semibold border-none px-2 py-0.5 text-xs", theme === "dark" ? "bg-blue-600/80 text-white" : "bg-blue-500/80 text-white")}>
                          Most Popular
                        </Badge>
                      </motion.div>
                    )}
                  </h2>
                  <p className={cn("mt-2 text-xs md:text-sm", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                    {product.description}
                  </p>
                  <motion.div className="mt-4 md:mt-6" key={billingCycle} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <span className={cn("text-3xl md:text-4xl font-extrabold", theme === "dark" ? "text-white" : "text-gray-900")}>
                      {product.priceString}
                    </span>
                    <span className={cn("text-sm md:text-base font-medium ml-1", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                      {product.billingInterval}
                    </span>
                    {isPremium && billingCycle === 'yearly' && (
                      <Badge variant="secondary" className="ml-2 text-xs font-semibold bg-green-500/20 text-green-300 border-green-500/30 dark:bg-green-500/20 dark:text-green-300 dark:border-green-500/30">
                        Save ₹1400
                      </Badge>
                    )}
                  </motion.div>
                </div>

                <div className="pt-4 pb-5 px-4 md:px-5 flex-grow">
                  <h3 className={cn("uppercase tracking-wide font-medium text-xs mb-3", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                    What's Included
                  </h3>
                  <ul className="space-y-2">
                    {product.features.map((feature, i) => (
                      <motion.li className="flex space-x-2 items-center" key={i} initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.3 + i * 0.06 }}>
                        <CircleCheck className={cn("w-4 h-4 flex-shrink-0", isPremium ? "text-blue-500 dark:text-blue-400" : theme === "dark" ? "text-green-400" : "text-green-500")} aria-hidden="true" />
                        <span className={cn("text-xs md:text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-700")}>{feature}</span>
                      </motion.li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 md:p-5">
                  {isPremium ? (
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                      <Button
                        onClick={handleSubscription} // Action assigned here
                        disabled={isLoading || !paddle || sessionStatus !== 'authenticated'} // Disable if loading or not authenticated
                        size="sm"
                        className={cn(
                           "w-full font-semibold",
                           theme === "dark" ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white border-0 shadow-md hover:shadow-lg hover:shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed" : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0 shadow-md hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed",
                         )}
                      >
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isLoading ? "Loading..." : (sessionStatus !== 'authenticated' ? "Log in to Upgrade" : product.buttonText)}
                      </Button>
                    </motion.div>
                  ) : (
                     <Button size="sm" disabled className={cn("w-full font-semibold opacity-70 cursor-not-allowed", theme === "dark" ? "bg-zinc-700 border border-white/10 text-neutral-400" : "bg-gray-300 border border-black/10 text-neutral-500")} variant="outline">
                       {product.buttonText}
                     </Button>
                  )}
                </div>

                {isPremium && (
                  <motion.div initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 0.8, delay: 0.5 }} className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-b-xl" />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};