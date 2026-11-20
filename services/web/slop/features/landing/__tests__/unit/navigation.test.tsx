import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/test-utils'
import { Navigation } from '../../navigation'
import { useScroll, useMotionValueEvent } from 'framer-motion'

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    useScroll: vi.fn(),
    useMotionValueEvent: vi.fn(),
  }
})

describe('Navigation', () => {
  const mockScrollY = { get: vi.fn(), onChange: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useScroll).mockReturnValue({ scrollY: mockScrollY } as any)
  })

  it('renders logo and nav items', () => {
    render(<Navigation />)
    expect(screen.getByText(/detect ai/i)).toBeInTheDocument()
  })

  it('updates background on scroll', () => {
    let scrollCallback: (v: number) => void = () => {}
    vi.mocked(useMotionValueEvent).mockImplementation((_val, _event, callback: any) => {
      scrollCallback = callback
    })

    const { container } = render(<Navigation />)
    const header = container.querySelector('header')
    
    // Initial state (not scrolled)
    expect(header).toHaveClass('py-5')

    // Scroll down
    act(() => {
      scrollCallback(50)
    })
    
    expect(header).toHaveClass('py-3')
    expect(header).toHaveClass('backdrop-blur-xl')

    // Scroll back up
    act(() => {
      scrollCallback(0)
    })
    
    expect(header).toHaveClass('py-5')
  })
})
