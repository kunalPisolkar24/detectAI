import type { ComponentProps } from "react";
import { cn } from "cn";

interface BulletListProps extends ComponentProps<"ul"> {
  items: readonly string[];
}

export function BulletList({ items, className, ...props }: BulletListProps) {
  return (
    <ul className={cn("space-y-3", className)} {...props}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-2 size-1.5 shrink-0 rounded-full bg-blue-500"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
