import type { Metadata } from "next";

import { Support } from "@/features/landing/components/support";

export const metadata: Metadata = {
  title: "Support | Detect AI",
  description:
    "Get help with Detect AI — getting started, billing and Premium, and questions about detection results.",
};

export default function SupportPage() {
  return <Support />;
}
