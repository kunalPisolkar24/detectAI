import type { BillingCycle, PricingPlan } from "../../constants";

interface PricingCardPriceProps {
  plan: PricingPlan;
  billingCycle: BillingCycle;
}

export function PricingCardPrice({ plan, billingCycle }: PricingCardPriceProps) {
  const period = billingCycle === "monthly" ? "month" : "year";

  return (
    <div className="mt-8 flex items-baseline gap-1">
      <span className="font-display text-3xl font-extrabold leading-none tracking-tight sm:text-4xl">
        {plan.price[billingCycle]}
      </span>
      <span className="text-sm font-medium text-muted-foreground">/{period}</span>
    </div>
  );
}
