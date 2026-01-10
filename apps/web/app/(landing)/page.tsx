import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import { HeroSection } from "@/features/landing/hero"

const Testimonials = dynamic(
  () => import("@/features/landing/testimonials").then((mod) => mod.Testimonials),
  {
    loading: () => (
      <div className="w-full h-96 flex items-center justify-center">
        <Skeleton className="w-full max-w-4xl h-64 rounded-xl" />
      </div>
    ),
  }
)

const Pricing = dynamic(
  () => import("@/features/landing/pricing").then((mod) => mod.Pricing),
  {
    loading: () => (
      <div className="w-full h-[600px] flex items-center justify-center">
        <Skeleton className="w-full max-w-5xl h-[500px] rounded-xl" />
      </div>
    ),
  }
)

const Faqs = dynamic(
  () => import("@/features/landing/faqs").then((mod) => mod.Faqs),
  {
    loading: () => <div className="w-full h-96" />,
  }
)

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <HeroSection />
      <Testimonials />
      <Pricing/>
      <Faqs/>
    </main>
  )
}