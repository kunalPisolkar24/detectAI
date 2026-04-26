import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import { NavMobile } from '../../../components/nav-mobile'

describe('NavMobile', () => {
  it('opens and closes the mobile menu', () => {
    render(<NavMobile />)
    
    // Trigger has PanelRight icon
    const buttons = screen.getAllByRole('button')
    const trigger = buttons.find(b => b.querySelector('svg.lucide-panel-right'))
    if (!trigger) throw new Error('Trigger not found')
    
    fireEvent.click(trigger)
    
    // Menu content should be visible
    expect(screen.getByText(/DOCS/i)).toBeInTheDocument()
    
    // Close button
    const closeButton = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-x'))
    if (closeButton) {
      fireEvent.click(closeButton)
    }
  })

  it('closes menu when a link is clicked', () => {
    render(<NavMobile />)
    const buttons = screen.getAllByRole('button')
    const trigger = buttons.find(b => b.querySelector('svg.lucide-panel-right'))
    if (trigger) fireEvent.click(trigger)
    
    const docsLink = screen.getByText(/DOCS/i)
    fireEvent.click(docsLink)
  })
})
