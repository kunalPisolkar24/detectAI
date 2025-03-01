import { Navigation, HeroSection, Testimonials, Footer, Pricing, Faqs } from "@/components/landing";

export default function Home() {
  return (
    <main className="flex flex-col min-h-screen items-center justify-center">
      <Navigation />
      <HeroSection/>
      <Testimonials/>
      <Pricing/>
      <Faqs/>
      <Footer/>
    </main>
  );
}