import type { Metadata } from 'next'
import { Navigation, HeroSection, Testimonials, Footer, Pricing, Faqs } from "@/components/landing";

export const metadata: Metadata = {
  title: 'Detect AI | Instant AI-Generated Text Detection',
  description: 'Quickly determine if a text is AI-generated. Our model provides fast and efficient predictions, classifying your content in seconds.',
}

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