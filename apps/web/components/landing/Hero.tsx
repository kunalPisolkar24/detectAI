"use client";
import React from "react";
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";

export const HeroSection = () => {
  return (
    <section className="w-full relative overflow-hidden min-h-screen flex flex-col items-center justify-center dark:bg-zinc-900">
      <div className="relative w-fit mx-auto flex flex-col items-center justify-center space-y-4 text-center z-40 backdrop-blur-[2px]">
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
          🎉 <hr className="mx-2 h-4 w-px shrink-0 bg-neutral-500" />
          <AnimatedGradientText className="text-sm font-medium">
            Introducing Detect AI
          </AnimatedGradientText>
          <ChevronRight
            className="ml-1 size-4 stroke-neutral-500 transition-transform duration-300 ease-in-out group-hover:translate-x-0.5"
          />
        </div>
        <h1 className="text-4xl sm:text-6xl lg:text-8xl font-extrabold tracking-tighter">
          Detect your text <span className="block">in Seconds!</span>
        </h1>
        <p className="mx-auto max-w-3xl text-xl mb-8 px-4 sm:px-6 tracking-tighter text-muted-foreground">
          Provide your text, and our model will predict its classification. Fast
          and efficient predictions in seconds.
        </p>
      </div>

      <div>
        <Link href="/auth/login">
          <Button
            className="rounded-md text-base h-12 mt-4 border"
            variant="default">
            Get started! <ArrowRight />
          </Button>
        </Link>
      </div>
    </section>
  );
};
