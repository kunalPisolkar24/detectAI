interface AuthHeaderProps {
  label: string
  title: string
}

export function AuthHeader({ label, title }: AuthHeaderProps) {
  return (
    <div className="space-y-2 text-center">
      <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">
        {label}
      </span>
      <h1 className="font-display text-3xl font-semibold tracking-wide text-foreground sm:text-4xl">
        {title}
      </h1>
    </div>
  )
}
