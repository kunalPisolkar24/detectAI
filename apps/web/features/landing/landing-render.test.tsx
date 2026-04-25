import { render } from '@testing-library/react'
import { describe, it, vi } from 'vitest'
import { HeroSection } from './hero'
import { Navigation } from './navigation'
import { Pricing } from './pricing'
import { Faqs } from './faqs'
import { Testimonials } from './testimonials'
import { Footer } from './footer'
import { PricingCard } from './components/pricing-card'
import { FaqItem } from './components/faq-item'
import { Accordion } from "@/components/ui/accordion"
import React from 'react'

// Mock framer-motion
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion')
  return {
    ...actual,
    useScroll: () => ({ scrollY: { get: () => 0, onChange: vi.fn() } }),
    useMotionValueEvent: vi.fn(),
  }
})

describe('Landing Structural Rendering', () => {
  it('renders Navigation without crashing', () => {
    render(<Navigation />)
  })

  it('renders HeroSection without crashing', () => {
    render(<HeroSection />)
  })

  it('renders Pricing without crashing', () => {
    render(<Pricing />)
  })

  it('renders Faqs without crashing', () => {
    render(<Faqs />)
  })

  it('renders Testimonials without crashing', () => {
    render(<Testimonials />)
  })

  it('renders Footer without crashing', () => {
    render(<Footer />)
  })

  it('renders PricingCard without crashing', () => {
    const mockPlan = {
      id: '1',
      name: 'Pro',
      description: 'Desc',
      price: { monthly: '$19', yearly: '$190' },
      features: ['Feature 1'],
      popular: true,
      cta: 'Get Started'
    }
    render(<PricingCard plan={mockPlan} billingCycle="monthly" index={0} />)
  })

  it('renders FaqItem without crashing', () => {
    render(
      <Accordion type="single" collapsible>
        <FaqItem question="Q" answer="A" index={0} />
      </Accordion>
    )
  })
})
