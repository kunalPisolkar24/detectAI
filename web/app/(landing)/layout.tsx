import { Footer } from "@/features/landing/footer"
import { Navigation } from "@/features/landing/navigation"

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Navigation />
      <main className="flex-grow pt-[var(--header-height,5rem)]">
        {children}
      </main>
      <Footer />
    </>
  )
}