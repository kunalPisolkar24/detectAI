"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { toast } from "sonner"
import { CreditCard, Sparkles, Loader2, AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"
import { teko, inter } from "@/lib/fonts"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cancelSubscriptionAction } from "../actions/cancel-subscription"

interface BillingTabProps {
  user: {
    isPremium: boolean
    subscriptionEndsAt: Date | null
    paddleSubscriptionStatus: string | null
  }
}

export const BillingTab = ({ user }: BillingTabProps) => {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleConfirmCancel = () => {
    startTransition(async () => {
      const result = await cancelSubscriptionAction()

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success("Subscription cancellation scheduled successfully.")
      setIsDialogOpen(false)
    })
  }

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-border/50">
          <h2 className={cn("text-2xl font-medium", teko.className)}>Subscription</h2>
        </div>

        <div className={cn(
          "relative overflow-hidden rounded-xl border p-6 transition-all",
          user.isPremium
            ? "bg-purple-500/5 border-purple-500/20"
            : "bg-card/50 border-border"
        )}>
          {user.isPremium && (
            <div className="absolute top-0 right-0 p-3">
              <Sparkles className="text-purple-500/20 w-24 h-24 -rotate-12" />
            </div>
          )}

          <div className="relative z-10">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className={cn("text-xl font-bold tracking-wide", teko.className)}>
                  {user.isPremium ? "Premium Plan" : "Free Plan"}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {user.isPremium
                    ? "You have access to advanced AI detection models."
                    : "You are currently on the limited free tier."}
                </p>
              </div>
              <div className={cn(
                "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border",
                user.isPremium
                  ? "bg-purple-500 text-white border-purple-600"
                  : "bg-secondary text-secondary-foreground border-border"
              )}>
                {user.paddleSubscriptionStatus || "Active"}
              </div>
            </div>

            {user.isPremium ? (
              <div className="flex flex-col gap-4">
                <div className="grid gap-1">
                  <span className="text-xs uppercase text-muted-foreground font-medium">Next Billing Date</span>
                  <span className={cn("text-lg", inter.className)}>
                    {user.subscriptionEndsAt
                      ? format(new Date(user.subscriptionEndsAt), "MMMM d, yyyy")
                      : "N/A"}
                  </span>
                </div>

                <div className="pt-4 flex gap-3">
                  <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={isPending}
                        className={cn(
                          "border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-500",
                          "dark:hover:bg-red-950/20 transition-all duration-200 tracking-wide text-lg",
                          teko.className
                        )}
                      >
                        CANCEL SUBSCRIPTION
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className={cn("flex items-center gap-2", teko.className)}>
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                          Confirm Cancellation
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground">
                          Are you sure you want to cancel your subscription?
                          <br /><br />
                          Your plan will remain active until <span className="font-medium text-foreground">{user.subscriptionEndsAt ? format(new Date(user.subscriptionEndsAt), "MMMM d, yyyy") : "the period ends"}</span>. After that, your account will revert to the Free tier.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel
                          disabled={isPending}
                          className={cn("text-base tracking-wide", teko.className)}
                        >
                          KEEP SUBSCRIPTION
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.preventDefault()
                            handleConfirmCancel()
                          }}
                          disabled={isPending}
                          className={cn(
                            "bg-red-600 hover:bg-red-700 text-white border-red-600 dark:border-red-600 tracking-wide text-lg",
                            teko.className
                          )}
                        >
                          {isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            "YES, CANCEL PLAN"
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ) : (
              <div className="pt-4">
                <Button
                  onClick={() => router.push("/upgrade")}
                  className={cn(
                    "w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700",
                    "text-white border-0 text-xl tracking-wide shadow-lg hover:shadow-xl transition-all duration-200",
                    teko.className
                  )}
                >
                  UPGRADE NOW
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-border/50">
          <h2 className={cn("text-2xl font-medium", teko.className)}>Payment Method</h2>
        </div>

        <div className="rounded-lg border border-border bg-card/50 p-6 flex flex-col items-center justify-center text-center space-y-3 min-h-[160px]">
          <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
            <CreditCard size={20} />
          </div>
          <p className="text-sm text-muted-foreground">
            {user.isPremium
              ? "Payment details are managed securely via Paddle. Check your email for invoice history."
              : "No payment method on file."}
          </p>
        </div>
      </section>
    </div>
  )
}