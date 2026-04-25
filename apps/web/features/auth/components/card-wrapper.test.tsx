import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { signIn } from 'next-auth/react'
import { CardWrapper } from './card-wrapper'

vi.mocked(signIn)

vi.mock('@/lib/core/fonts', () => ({
  teko: { className: 'teko' },
}))

describe('CardWrapper', () => {
  const defaultProps = {
    children: <div>Test Content</div>,
    label: 'Test Label',
    title: 'Test Title',
    backButtonHref: '/test-href',
    backButtonLabel: 'Test Back Label',
  }

  it('renders correctly with given props', () => {
    render(<CardWrapper {...defaultProps} />)
    
    expect(screen.getByText('Test Label')).toBeInTheDocument()
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test Content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /test back label/i })).toHaveAttribute('href', '/test-href')
  })

  it('renders social login buttons by default', () => {
    render(<CardWrapper {...defaultProps} />)
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /github/i })).toBeInTheDocument()
  })

  it('does not render social login buttons when showSocial is false', () => {
    render(<CardWrapper {...defaultProps} showSocial={false} />)
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /github/i })).not.toBeInTheDocument()
  })

  it('calls signIn with google provider when google button is clicked', async () => {
    const user = userEvent.setup()
    render(<CardWrapper {...defaultProps} />)
    const googleButton = screen.getByRole('button', { name: /google/i })
    
    await user.click(googleButton)
    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/chat' })
  })

  it('calls signIn with github provider when github button is clicked', async () => {
    const user = userEvent.setup()
    render(<CardWrapper {...defaultProps} />)
    const githubButton = screen.getByRole('button', { name: /github/i })
    
    await user.click(githubButton)
    expect(signIn).toHaveBeenCalledWith('github', { callbackUrl: '/chat' })
  })
})
