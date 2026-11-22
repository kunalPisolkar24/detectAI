import { CircleCheck } from "lucide-react";
import { cn } from "cn";

interface FeatureListProps {
  features: readonly string[];
  className?: string;
}

export function FeatureList({ features, className }: FeatureListProps) {
  return (
    <ul className={cn("space-y-3", className)}>
      {features.map((feature) => (
        <li key={feature} className="flex items-start gap-3">
          <CircleCheck
            className="mt-0.5 size-5 shrink-0 text-blue-600 dark:text-blue-400"
            aria-hidden="true"
          />
          <span className="text-sm leading-tight text-muted-foreground">
            {feature}
          </span>
        </li>
      ))}
    </ul>
  );
}
