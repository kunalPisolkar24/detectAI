"use client";
import React, { useState } from "react";
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text";
import { cn } from "@workspace/ui/lib/utils";
import { Tabs,TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { CircleCheck } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import Link from "next/link";

export const Pricing = () => {
  // State to track whether the user selects "monthly" or "yearly"
  const [billingCycle, setBillingCycle] = useState("monthly");

  // Define pricing for both billing cycles
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
      buttonText: "Get Started",
      buttonVariant: "outline",
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
      buttonVariant: "default",
    },
  ];

  return (
    <section className="w-full flex flex-col items-center justify-center">
      <div className="w-full container px-6 sm:px-8 lg:mx-auto py-32 flex flex-col items-center justify-center space-y-8">
        <div className="text-center flex flex-col items-center justify-center">
      <div className="group relative mx-auto flex items-center justify-center rounded-full px-4 py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] transition-shadow duration-500 ease-out hover:shadow-[inset_0_-5px_10px_#8fdfff3f] ">
        <span
          className={cn(
            "absolute inset-0 block h-full w-full animate-gradient rounded-[inherit] bg-gradient-to-r from-[#ffaa40]/50 via-[#9c40ff]/50 to-[#ffaa40]/50 bg-[length:300%_100%] p-[1px]"
          )}
          style={{
            WebkitMask:
              "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "destination-out",
            mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            maskComposite: "subtract",
            WebkitClipPath: "padding-box",
          }}
        />
        <AnimatedGradientText className="text-sm font-medium">
        Pricing
        </AnimatedGradientText>
      </div>

          <h1 className="mt-4 capitalize text-4xl font-bold">
            Choose the Plan for AI Text Detection
          </h1>
          <p className="text-base text-muted-foreground max-w-xl mt-3">
            From simple AI text detection to in-depth analysis with advanced models like BERT, choose the plan that fits your requirements.
          </p>
        </div>

        <div>
          <Tabs
            onValueChange={setBillingCycle} // Update state when tab is clicked
            defaultValue="monthly"
            className="bg-background/50 border border-border p-1 rounded-xl shadow-md"
          >
            <TabsList className="grid w-full grid-cols-2 rounded-lg">
              <TabsTrigger className="font-semibold" value="monthly">
                Monthly
              </TabsTrigger>
              <TabsTrigger className="font-semibold" value="yearly">
                Yearly
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-14 mt-16 place-items-center mx-auto">
          {products.map((product) => {
            return (
              <div
                key={product.id}
                className={cn(
                  "border bg-background rounded-xl shadow-sm h-full min-h-[450px] w-full sm:w-[300px] lg:w-[400px] flex flex-col justify-between divide-y divide-border",
                  product.name === "Premium"
                    ? "border-primary bg-background drop-shadow-md"
                    : "border-border"
                )}
              >
                <div className="p-6 flex-1">
                  <h2 className="text-2xl leading-6 font-semibold text-foreground flex items-center justify-between">
                    {product.name}
                    {product.name === "Premium" && (
                      <Badge className="border-border font-semibold">
                        Most Popular
                      </Badge>
                    )}
                  </h2>

                  {/* Description */}
                  <p className="text-muted-foreground mt-2">{product.description}</p>

                  {/* Dynamic Price */}
                  <p className="mt-8">
                    <span className="text-4xl font-extrabold text-foreground">
                      {product.priceString}
                    </span>
                    <span className="text-base font-medium text-muted-foreground">
                      {product.billingInterval}
                    </span>
                  </p>
                </div>

                {/* Features List */}
                <div className="pt-6 pb-8 px-6 flex-grow">
                  <h3 className="uppercase tracking-wide text-foreground font-medium text-sm">
                    What&apos;s included
                  </h3>
                  <ul className="mt-6 space-y-4">
                    {product.features.map((feature, i) => (
                      <li className="flex space-x-3" key={i}>
                        <CircleCheck className="w-5 h-5 text-primary" />
                        <span className="text-sm text-muted-foreground">
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Subscribe Button at the Bottom */}
                <div className="p-6 border-t border-border">
                  <Link href="/auth/login">
                    <Button
                      className="w-full font-semibold"
                      variant={
                        product?.name?.toLocaleLowerCase() === "premium"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {product.name === "Premium" ? "Subscribe" : "Get Started"}
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

