import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { About } from '../../about'
import { Contact } from '../../contact'
import { Support } from '../../support'
import { Footer } from '../../footer'
import { PageHero } from '../../components/page-hero'
import { BotIcon } from 'lucide-react'
import React from 'react'

describe('Info pages', () => {
  it('renders the shared page hero', () => {
    render(<PageHero badge="Test badge" icon={BotIcon} title="Test title" description="Test description" />)

    expect(screen.getByText('Test badge')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Test title' })).toBeInTheDocument()
    expect(screen.getByText('Test description')).toBeInTheDocument()
  })

  it('renders About with models and signup CTA', () => {
    render(<About />)

    expect(screen.getByRole('heading', { name: /Human or AI\? Now you know\./i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Spark' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Flare' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Try Spark free/i })).toHaveAttribute('href', '/signup')
    expect(screen.getByRole('link', { name: /Go Flare/i })).toHaveAttribute('href', '/upgrade')
    expect(screen.getByRole('link', { name: /Get started/i })).toHaveAttribute('href', '/signup')
  })

  it('renders Contact with working mailto actions', () => {
    render(<Contact />)

    expect(screen.getByRole('heading', { name: /Talk to a human\./i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Email us/i })).toHaveAttribute(
      'href',
      'mailto:info@detectai.com',
    )
    expect(screen.getByRole('link', { name: /Get support/i })).toHaveAttribute(
      'href',
      'mailto:info@detectai.com?subject=Support%20request',
    )
    expect(screen.getByRole('link', { name: /Visit support/i })).toHaveAttribute('href', '/support')
  })

  it('renders Support topics with subject-prefilled email links', () => {
    render(<Support />)

    expect(screen.getByRole('heading', { name: /How can we help\?/i })).toBeInTheDocument()

    const emailLinks = screen.getAllByRole('link', { name: /Email support/i })
    expect(emailLinks).toHaveLength(3)
    expect(emailLinks[0]).toHaveAttribute(
      'href',
      'mailto:info@detectai.com?subject=Getting%20started%20question',
    )
    expect(emailLinks[1]).toHaveAttribute(
      'href',
      'mailto:info@detectai.com?subject=Billing%20question',
    )
    expect(emailLinks[2]).toHaveAttribute(
      'href',
      'mailto:info@detectai.com?subject=Question%20about%20my%20results',
    )
  })

  it('links Support from the footer Company section', () => {
    render(<Footer />)

    expect(screen.getByRole('link', { name: /Support/i })).toHaveAttribute('href', '/support')
  })
})
