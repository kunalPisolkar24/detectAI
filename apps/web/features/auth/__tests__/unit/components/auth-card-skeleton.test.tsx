import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { AuthCardSkeleton } from '../../../components/auth-card-skeleton'

describe('AuthCardSkeleton', () => {
  it('renders correctly', () => {
    const { container } = render(<AuthCardSkeleton />)
    
    // Check if it renders multiple skeleton items
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
    
    // Check for specific structure elements
    expect(container.querySelector('.rounded-xl')).toBeInTheDocument()
  })
})
