"use client";

import { m, type HTMLMotionProps } from "framer-motion";
import { cn } from "cn";

interface FadeInProps extends Omit<HTMLMotionProps<"div">, "y"> {
  delay?: number;
  duration?: number;
  y?: number;
  once?: boolean;
}

export function FadeIn({
  delay = 0,
  duration = 0.5,
  y = 20,
  once = true,
  className,
  children,
  ...props
}: FadeInProps) {
  return (
    <m.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once }}
      transition={{ duration, delay }}
      className={cn(className)}
      {...props}
    >
      {children}
    </m.div>
  );
}
