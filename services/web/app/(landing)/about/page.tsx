import type { Metadata } from "next";

import { About } from "@/features/landing/components/about";

export const metadata: Metadata = {
  title: "About | Detect AI",
  description:
    "Learn what Detect AI does, meet the Spark and Flare detection models, and see how chunk-level analysis works.",
};

export default function AboutPage() {
  return <About />;
}
