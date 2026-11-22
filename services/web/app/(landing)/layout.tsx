import type { ReactNode } from "react";

import { Footer } from "@/features/landing/components/footer";
import { Navigation } from "@/features/landing/components/navigation";

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navigation />
      <main className="flex min-h-screen flex-col">{children}</main>
      <Footer />
    </>
  );
}
