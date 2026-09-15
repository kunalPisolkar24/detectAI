import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LandingHashScroll } from '../../components/landing-hash-scroll'
import { Faqs } from '../../faqs'
import { Pricing } from '../../pricing'
import React from 'react'

describe('LandingHashScroll', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    window.location.hash = ''
  })

  afterEach(() => {
    window.location.hash = ''
    // @ts-expect-error - restore jsdom default (undefined)
    window.HTMLElement.prototype.scrollIntoView = undefined
  })

  it('renders nothing', () => {
    const { container } = render(<LandingHashScroll />)
    expect(container).toBeEmptyDOMElement()
  })

  it('smooth-scrolls to the hashed section on hash change', async () => {
    render(
      <>
        <LandingHashScroll />
        <section id="pricing">Pricing section</section>
      </>,
    )
    window.location.hash = '#pricing'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    })
  })

  it('exposes pricing and faqs section anchors with header offset', () => {
    render(<Pricing />)
    const pricing = document.getElementById('pricing')
    expect(pricing).not.toBeNull()
    expect(pricing).toHaveClass('scroll-mt-20')

    render(<Faqs />)
    const faqs = document.getElementById('faqs')
    expect(faqs).not.toBeNull()
    expect(faqs).toHaveClass('scroll-mt-20')
  })
})
