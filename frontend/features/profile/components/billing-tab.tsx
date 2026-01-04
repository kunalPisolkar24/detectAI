"use client"

import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { teko, inter } from "@/lib/fonts"
import { Button } from "@/components/ui/button"
import { CreditCard, Sparkles } from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"

interface BillingTabProps {
  user: {
    isPremium: boolean
    subscriptionEndsAt: Date | null
    paddleSubscriptionStatus: string | null
  }
}

export const BillingTab = ({ user }: BillingTabProps) => {
  const router = useRouter()
  const handleCancel = () => {
    toast.info("Subscription cancellation feature is coming soon.")
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
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    className={cn(
                      "border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white hover:border-red-500 tracking-wide text-lg transition-all duration-200",
                      teko.className
                    )}
                  >
                    CANCEL SUBSCRIPTION
                  </Button>
                </div>
              </div>
            ) : (
              <div className="pt-4">
                <Button
                  onClick={() => router.push("/upgrade")}
                  className={cn(
                    "w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0 text-xl tracking-wide shadow-lg hover:shadow-xl transition-all duration-200",
                    teko.className
                  )}
                >
                  Upgrade Now
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
            Payment details are managed securely via Paddle.
            <br />
            {user.isPremium ? "View your invoice history in the Paddle dashboard." : "No payment method on file."}
          </p>
        </div>
      </section>
    </div>
  )
}