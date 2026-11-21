import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { GlassPanel } from "@/components/ui/glass-panel";
import type { Review } from "../../constants";

interface ReviewCardProps {
  review: Review;
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

export function ReviewCard({ review }: ReviewCardProps) {
  return (
    <figure className="mx-2 w-64 shrink-0 transition-transform duration-300 hover:-translate-y-1">
      <GlassPanel className="h-full overflow-hidden">
        <div className="p-4">
          <div className="flex flex-row items-center gap-2">
            <Avatar brand>
              <AvatarFallback>
                <span className="text-purple-600 dark:text-purple-400">
                  {initialsOf(review.name)}
                </span>
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <figcaption className="text-sm font-medium text-foreground">
                {review.name}
              </figcaption>
              <p className="text-xs font-medium text-muted-foreground">
                {review.username}
              </p>
            </div>
          </div>
          <blockquote className="mt-2 text-sm text-muted-foreground">
            {review.body}
          </blockquote>
        </div>
        <div className="h-0.5 bg-gradient-to-r from-blue-500 to-purple-500" />
      </GlassPanel>
    </figure>
  );
}
