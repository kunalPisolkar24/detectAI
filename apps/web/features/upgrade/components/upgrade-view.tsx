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
import { teko, inter } from "@/lib/core/fonts"
import { Button } from "@/components/ui/button"
import { Pricing } from "@/features/landing/pricing"
import { isPreviewModeClient, setPreviewPremium } from "@/lib/config/preview"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const PREMIUM_MONTHLY_PRICE_ID = "pri_01jr2gqggwjakpc1hd9xzym7fy"
const PREMIUM_YEARLY_PRICE_ID = "pri_01jr2gs8ckz66srr8sd1byh7n4"

export const UpgradeView = () => {
  const router = useRouter()
  const { data: session, status, update: updateSession } = useSession()
  const isPreview = isPreviewModeClient()
  const [paddle, setPaddle] = useState<Paddle | undefined>()
  const [isPaddleInitializing, setIsPaddleInitializing] = useState(!isPreview)
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)
  const [pendingCycle, setPendingCycle] = useState<"monthly" | "yearly">("monthly")

  const PENDING_KEY = "pendingUpgrade"
  const PENDING_TTL_MS = 7200000 // 2hr covers JWT 1h + buffer

  const pollViaServerAction = async () => {
    try {
      const result = await confirmUpgradeAction()
      if (result.isPremium) {
        try {
          localStorage.removeItem(PENDING_KEY)
        } catch {}
        await updateSession({ isPremium: true })
        toast.success("Premium activated! Welcome to Flare.")
        router.push("/chat?upgrade_success=true")
      } else {
        toast.warning("Your subscription is being activated, please refresh.")
      }
      return result
    } catch (error) {
      console.error("Poll via server action failed:", error)
      toast.warning("Your subscription is being activated, please refresh.")
      return { isPremium: false }
    }
  }

  const handleCheckoutCompleted = async () => {
    toast.success("Payment received! Activating your Premium access…")
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ ts: Date.now() }))
    } catch {}
    await pollViaServerAction()
  }

  useEffect(() => {
    if (isPreview) {
      setIsPaddleInitializing(false)
      return
    }
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
  }, [isPreview])

  useEffect(() => {
    if (isPreview) return
    if (typeof window === "undefined") return
    if (status !== "authenticated") return
    if (session?.user.isPremium) {
      try {
        localStorage.removeItem(PENDING_KEY)
      } catch {}
      return
    }
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { ts: number }
      if (!parsed.ts || Date.now() - parsed.ts > PENDING_TTL_MS) {
        localStorage.removeItem(PENDING_KEY)
        return
      }
      void pollViaServerAction()
    } catch {
      try {
        localStorage.removeItem(PENDING_KEY)
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.user.isPremium, isPreview])

  const handleConfirmPreviewUpgrade = async () => {
    setPreviewPremium(true)
    try {
      await updateSession({ isPremium: true })
    } catch {}
    toast.success("Premium activated! Welcome to Flare. (Preview mode — no payment)")
    setPreviewDialogOpen(false)
    router.push("/chat?upgrade_success=true")
  }

  const handlePlanSelect = (planId: string, billingCycle: "monthly" | "yearly") => {
    if (planId !== "flare") {
      return
    }

    if (status !== "authenticated" || !session?.user) {
      toast.error("Please log in to upgrade.")
      router.push("/login?callbackUrl=/upgrade")
      return
    }

    if (isPreview) {
      setPendingCycle(billingCycle)
      setPreviewDialogOpen(true)
      return
    }

    if (!paddle) {
      toast.error("Payment system is still loading. Please try again.")
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

      {isPreview && (
        <AlertDialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className={cn("flex items-center gap-2 tracking-wide", teko.className)}>
                <span className="text-xl">Upgrade to Premium?</span>
                <span className={cn("rounded-md border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300", inter.className)}>
                  Preview
                </span>
              </AlertDialogTitle>
              <AlertDialogDescription>
                You are in preview mode. No payment will be processed. Your account will be upgraded to Premium locally
                ({pendingCycle}) and unlock Flare immediately. You can cancel anytime from Profile.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={cn(teko.className, "text-base")}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmPreviewUpgrade} className={cn(teko.className, "text-base bg-gradient-to-r from-blue-600 to-purple-600 text-white")}>
                Yes, upgrade my account
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}