import { Navigation, HeroSection } from "@/components/landing";

export default function Home() {
  return (
    <main className="flex flex-col min-h-screen items-center justify-center">
      <Navigation />
      <HeroSection/>
    </main>
  );
}