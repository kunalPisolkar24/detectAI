import { Faq } from "@/features/landing/components/faq";
import { HeroSection } from "@/features/landing/components/hero";
import { Pricing } from "@/features/landing/components/pricing";
import { Testimonials } from "@/features/landing/components/testimonials";

export default function Home() {
  return (
    <>
      <HeroSection />
      <Testimonials />
      <Pricing />
      <Faq />
    </>
  );
}
