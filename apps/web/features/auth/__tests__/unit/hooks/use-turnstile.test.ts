import { renderHook, act } from '@testing-library/react'
import { useTurnstile } from '../../../hooks/use-turnstile'
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('useTurnstile', () => {
  it('initializes with default values', () => {
    const { result } = renderHook(() => useTurnstile())
    expect(result.current.token).toBeNull()
    expect(result.current.errorCode).toBeNull()
    expect(result.current.isConfigured).toBe(true) // Based on mock in setup.ts
  })

  it('updates token on verify', () => {
    const { result } = renderHook(() => useTurnstile())
    act(() => {
      result.current.onVerify('new-token')
    })
    expect(result.current.token).toBe('new-token')
    expect(result.current.errorCode).toBeNull()
  })

  it('handles errors', () => {
    const { result } = renderHook(() => useTurnstile())
    act(() => {
      result.current.onError('expired')
    })
    expect(result.current.token).toBeNull()
    expect(result.current.errorCode).toBe('expired')
    expect(result.current.errorMessage).toBe('Verification expired. Retry to continue.')
  })

  it('handles expiration', () => {
    const { result } = renderHook(() => useTurnstile())
    act(() => {
      result.current.onExpire()
    })
    expect(result.current.token).toBeNull()
    expect(result.current.errorCode).toBe('expired')
  })

  it('handles timeout', () => {
    const { result } = renderHook(() => useTurnstile())
    act(() => {
      result.current.onTimeout()
    })
    expect(result.current.token).toBeNull()
    expect(result.current.errorCode).toBe('timeout')
    expect(result.current.errorMessage).toBe('Verification timed out. Retry to continue.')
  })

  it('resets state correctly', () => {
    const { result } = renderHook(() => useTurnstile())
    act(() => {
      result.current.onVerify('token')
      result.current.onError('error')
    })
    
    const initialKey = result.current.key
    
    act(() => {
      result.current.reset()
    })
    
    expect(result.current.token).toBeNull()
    expect(result.current.errorCode).toBeNull()
    expect(result.current.key).toBe(initialKey + 1)
  })
})
