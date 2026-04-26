import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cancelSubscriptionAction } from '../../../actions/cancel-subscription'
import { getServerSession } from 'next-auth'
import { prismaMock } from '@/test/prisma-mock'
import { userService } from '@/features/auth/services/user-service'
import { revalidatePath } from 'next/cache'
import { SubscriptionStatus } from '@/lib/shared/generated/prisma/client'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/features/auth/services/user-service', () => ({
  userService: {
    invalidateUserCache: vi.fn(),
  },
}))

vi.mock('@/lib/config/auth-options', () => ({
  authOptions: {},
}))

describe('cancelSubscriptionAction', () => {
  const mockUserId = 'user-123'
  const mockEmail = 'test@example.com'

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('returns error if unauthorized', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await cancelSubscriptionAction()
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('returns error if no active subscription found', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: mockUserId } } as any)
    prismaMock.user.findUnique.mockResolvedValue(null)

    const result = await cancelSubscriptionAction()
    expect(result).toEqual({ error: 'No active subscription details found.' })
  })

  it('returns error if subscription is already inactive', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: mockUserId } } as any)
    prismaMock.user.findUnique.mockResolvedValue({
      id: mockUserId,
      email: mockEmail,
      paddleSubscriptionId: 'sub-1',
      paddleSubscriptionStatus: SubscriptionStatus.PAST_DUE,
    } as any)

    const result = await cancelSubscriptionAction()
    expect(result).toEqual({ error: 'Subscription is already inactive.' })
  })

  it('successfully cancels subscription', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: mockUserId } } as any)
    prismaMock.user.findUnique.mockResolvedValue({
      id: mockUserId,
      email: mockEmail,
      paddleSubscriptionId: 'sub-1',
      paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
    } as any)

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
    } as any)

    const result = await cancelSubscriptionAction()

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: mockUserId },
      data: { paddleCancellationScheduled: true }
    })
    expect(userService.invalidateUserCache).toHaveBeenCalledWith(mockUserId, mockEmail)
    expect(fetch).toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/profile')
    expect(result).toEqual({ success: true })
  })

  it('reverts database state if gateway call fails', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: mockUserId } } as any)
    prismaMock.user.findUnique.mockResolvedValue({
      id: mockUserId,
      email: mockEmail,
      paddleSubscriptionId: 'sub-1',
      paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
    } as any)

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
    } as any)

    const result = await cancelSubscriptionAction()

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: mockUserId },
      data: { paddleCancellationScheduled: false }
    })
    expect(result).toEqual({ error: 'Failed to communicate with payment provider. Please try again.' })
  })

  it('handles exceptions', async () => {
    vi.mocked(getServerSession).mockRejectedValue(new Error('Unexpected'))
    const result = await cancelSubscriptionAction()
    expect(result).toEqual({ error: 'An unexpected error occurred.' })
  })
})
