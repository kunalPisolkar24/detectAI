import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";

import type { BillingCycle, PricingPlan } from "../../constants";
import { FeatureList } from "./feature-list";
import { PricingCardPrice } from "./pricing-card-price";

interface PricingCardProps {
  plan: PricingPlan;
  billingCycle: BillingCycle;
}

export function PricingCard({ plan, billingCycle }: PricingCardProps) {
  return (
    <GlassPanel elevated={plan.featured} brand={plan.featured} className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-semibold sm:text-2xl">{plan.name}</h3>
          {plan.featured && <Badge variant="secondary">Most Popular</Badge>}
        </div>

        <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>

        <PricingCardPrice plan={plan} billingCycle={billingCycle} />

        <div className="mt-6 h-px w-full bg-black/10 dark:bg-white/10" />
        <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-foreground">
          What&apos;s Included
        </h4>
        <FeatureList features={plan.features} className="mt-4" />
      </div>

      <div className="p-6 pt-0">
        <Button
          asChild
          variant={plan.featured ? "brand" : "outline"}
          size={plan.featured ? "pricing" : "lg"}
          className="w-full"
        >
          <Link href="/signup">{plan.cta}</Link>
        </Button>
      </div>

      {plan.featured && (
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-purple-500" />
      )}
    </GlassPanel>
  );
}
