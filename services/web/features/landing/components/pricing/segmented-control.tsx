import { cn } from "cn";

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  badge?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white/70 p-1 backdrop-blur-sm dark:border-white/10 dark:bg-black/40",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm transition-colors",
            value === option.value
              ? "bg-background font-semibold text-foreground shadow-sm ring-1 ring-black/5 dark:bg-white/5 dark:ring-white/10"
              : "font-medium text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
          {option.badge && (
            <span className="rounded-full border border-blue-500/50 bg-gradient-to-r from-blue-500/15 to-purple-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-600 dark:border-blue-400/50 dark:text-blue-400">
              {option.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
