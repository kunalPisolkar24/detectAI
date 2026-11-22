import { Faq } from "@/features/landing/components/faq";
import { HeroSection } from "@/features/landing/components/hero";
import { Navigation } from "@/features/landing/components/navigation";
import { Pricing } from "@/features/landing/components/pricing";
import { Testimonials } from "@/features/landing/components/testimonials";

export default function Home() {
  return (
    <>
      <Navigation />
      <main className="flex min-h-screen flex-col">
        <HeroSection />
        <Testimonials />
        <Pricing />
        <Faq />
      </main>
    </>
  );
}
