import type { ComponentProps } from "react";
import { cn } from "cn";

export function Section({ className, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("w-full py-12 sm:py-16", className)} {...props} />
  );
}
