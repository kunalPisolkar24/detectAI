"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { initializePaddle, Paddle } from "@paddle/paddle-js"
import { ArrowLeft } from "lucide-react"
import { confirmUpgradeAction } from "../actions/confirm-upgrade"
import { toast } from "sonner"
import { cn } from "@/lib/core/utils"
import { env } from "@/lib/config/env"
import { teko } from "@/lib/core/fonts"
import { Button } from "@/components/ui/button"
import { Pricing } from "@/features/landing/pricing"

const PREMIUM_MONTHLY_PRICE_ID = "pri_01jr2gqggwjakpc1hd9xzym7fy"
const PREMIUM_YEARLY_PRICE_ID = "pri_01jr2gs8ckz66srr8sd1byh7n4"

export const UpgradeView = () => {
  const router = useRouter()
  const { data: session, status, update: updateSession } = useSession()
  const [paddle, setPaddle] = useState<Paddle | undefined>()
  const [isPaddleInitializing, setIsPaddleInitializing] = useState(true)

  useEffect(() => {
    const initPaddle = async () => {
      try {
        if (env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN) {
          const paddleInstance = await initializePaddle({
            token: env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
            environment: "sandbox",
            eventCallback: async (data) => {
              if (data.name === "checkout.completed") {
                await handleCheckoutCompleted()
              }
            },
          })
          setPaddle(paddleInstance)
        }
      } catch (error) {
        console.error("Paddle initialization error:", error)
        toast.error("Failed to load payment system")
      } finally {
        setIsPaddleInitializing(false)
      }
    }

    initPaddle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCheckoutCompleted = async () => {
    toast.success("Payment received! Activating your Premium access…")
    const result = await confirmUpgradeAction()

    if (result.isPremium) {
      await updateSession({ isPremium: true })
      toast.success("Premium activated! Welcome to Flare.")
      router.push("/chat?upgrade_success=true")
    } else {
      toast.warning(
        "Your subscription is being activated, please refresh."
      )
    }
  }

  const handlePlanSelect = (planId: string, billingCycle: "monthly" | "yearly") => {
    if (planId !== "flare") {
      return
    }

    if (!paddle) {
      toast.error("Payment system is still loading. Please try again.")
      return
    }

    if (status !== "authenticated" || !session?.user) {
      toast.error("Please log in to upgrade.")
      router.push("/login?callbackUrl=/upgrade")
      return
    }

    const priceId = billingCycle === "monthly"
      ? PREMIUM_MONTHLY_PRICE_ID
      : PREMIUM_YEARLY_PRICE_ID

    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: {
        email: session.user.email || "",
      },
      customData: {
        userId: session.user.id
      },
      settings: {
        theme: "dark",
        displayMode: "overlay"
      }
    })
  }

  return (
    <div className="min-h-screen w-full bg-background text-foreground relative overflow-x-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-start mb-2">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="group pl-2 pr-4 gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
          >
            <ArrowLeft size={18} className="text-neutral-500 group-hover:text-foreground transition-colors" />
            <span className={cn("text-lg pt-1 tracking-wide text-neutral-500 group-hover:text-foreground", teko.className)}>
              Back
            </span>
          </Button>
        </div>

        <Pricing
          isUpgradePage={true}
          onPlanSelect={handlePlanSelect}
          isProcessing={isPaddleInitializing}
        />
      </div>
    </div>
  )
}