import { Marquee } from "@/components/ui/marquee";
import type { Review } from "../../constants";
import { ReviewCard } from "./review-card";

interface TestimonialsMarqueeProps {
  reviews: Review[];
  reverse?: boolean;
}

export function TestimonialsMarquee({ reviews, reverse = false }: TestimonialsMarqueeProps) {
  return (
    <Marquee duration="20s" pauseOnHover reverse={reverse} fadeEdges>
      {reviews.map((review) => (
        <ReviewCard key={review.username} review={review} />
      ))}
    </Marquee>
  );
}
