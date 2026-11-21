import { HeroSection } from "@/features/landing/components/hero";
import { Navigation } from "@/features/landing/components/navigation";

export default function Home() {
  return (
    <>
      <Navigation />
      <main className="flex min-h-screen flex-col">
        <HeroSection />
      </main>
    </>
  );
}
