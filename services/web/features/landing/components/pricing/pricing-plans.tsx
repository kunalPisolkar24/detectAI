"use client";

import { useState } from "react";

import { Container } from "@/components/layout/container";
import { FadeIn } from "@/components/motion/fade-in";

import { PRICING_PLANS, PRICING_TEXT, type BillingCycle } from "../../constants";
import { BillingToggle } from "./billing-toggle";
import { PricingCard } from "./pricing-card";

export function PricingPlans() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  return (
    <Container className="mt-10 flex flex-col items-center">
      <FadeIn delay={0.2}>
        <BillingToggle value={billingCycle} onChange={setBillingCycle} />
      </FadeIn>

      <div className="mt-10 grid w-full grid-cols-1 gap-8 sm:grid-cols-2 lg:gap-12">
        {PRICING_PLANS.map((plan, index) => (
          <FadeIn key={plan.id} delay={0.3 + index * 0.15} className="h-full">
            <PricingCard plan={plan} billingCycle={billingCycle} />
          </FadeIn>
        ))}
      </div>

      <FadeIn delay={0.7} className="mt-8">
        <p className="text-center text-sm text-muted-foreground">
          {PRICING_TEXT.note}
        </p>
      </FadeIn>
    </Container>
  );
}
