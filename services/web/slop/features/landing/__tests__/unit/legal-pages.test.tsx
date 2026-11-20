import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Terms } from '../../terms'
import { Privacy } from '../../privacy'
import { LegalLayout } from '../../components/legal-layout'
import { Footer } from '../../footer'
import React from 'react'

describe('Legal pages', () => {
  it('renders the shared legal layout with TOC anchors', () => {
    render(
      <LegalLayout
        updated="September 2026"
        sections={[
          { id: 'first', title: 'First section', content: <p>First body</p> },
          { id: 'second', title: 'Second section', content: <p>Second body</p> },
        ]}
        contactTitle="Contact title"
        contactDescription="Contact description"
        contactSubject="Legal subject"
      />,
    )

    expect(screen.getByText(/Last updated: September 2026/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /First section/i })).toHaveAttribute('href', '#first')
    expect(screen.getByRole('link', { name: /Second section/i })).toHaveAttribute('href', '#second')
    expect(screen.getByText('First body')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Contact us/i })).toHaveAttribute(
      'href',
      'mailto:info@detectai.com?subject=Legal%20subject',
    )
  })

  it('renders Terms with all sections and contact CTA', () => {
    render(<Terms />)

    expect(screen.getByRole('heading', { name: /Terms of Service/i })).toBeInTheDocument()

    const toc = screen.getByRole('navigation', { name: /Table of contents/i })
    const tocLinks = within(toc).getAllByRole('link')
    expect(tocLinks.length).toBeGreaterThanOrEqual(8)

    for (const section of [
      'Acceptance of these terms',
      'Plans and billing',
      'AI-generated results',
      'Disclaimers and liability',
    ]) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument()
    }
  })

  it('renders Privacy with all sections', () => {
    render(<Privacy />)

    expect(screen.getByRole('heading', { name: /Privacy Policy/i })).toBeInTheDocument()

    for (const section of [
      'Information we collect',
      'Text you submit for analysis',
      'Third-party services',
      'Your rights',
    ]) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument()
    }
  })

  it('links Terms and Privacy from the footer', () => {
    render(<Footer />)

    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  })
})
