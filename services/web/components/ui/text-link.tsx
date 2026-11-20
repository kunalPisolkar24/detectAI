import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "cn";

interface TextLinkProps extends ComponentProps<typeof Link> {
  showArrow?: boolean;
  external?: boolean;
}

export function TextLink({
  showArrow = false,
  external = false,
  className,
  children,
  ...props
}: TextLinkProps) {
  return (
    <Link
      {...props}
      target={external ? "_blank" : props.target}
      rel={external ? "noopener noreferrer" : props.rel}
      className={cn(
        "inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline",
        className,
      )}
    >
      {children}
      {showArrow && (
        <ArrowUpRight className="size-3 text-blue-500 dark:text-blue-400" aria-hidden="true" />
      )}
    </Link>
  );
}
