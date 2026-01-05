import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function AuthCardSkeleton() {
  return (
    <Card className={cn(
      "w-full border shadow-xl backdrop-blur-md",
      "bg-white/70 border-black/10",
      "dark:bg-black/50 dark:border-white/10"
    )}>
      <CardHeader className="space-y-1 flex flex-col items-center justify-center">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-10 w-48 mt-2" />
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>

        <div className="relative flex justify-center">
          <Skeleton className="h-4 w-32" />
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>

        <Skeleton className="h-12 w-full rounded-md" />
      </CardContent>

      <CardFooter className="justify-center">
        <Skeleton className="h-4 w-48" />
      </CardFooter>
    </Card>
  )
}