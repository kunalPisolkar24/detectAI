import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateProfileAction } from '../../actions/update-profile'
import { cancelSubscriptionAction } from '../../actions/cancel-subscription'
import { prisma } from '@/lib/infrastructure/prisma'
import { redisWriter } from '@/lib/infrastructure/redis'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'

import { SubscriptionStatus } from '@/lib/shared/generated/prisma/client'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

describe('Profile Actions Integration', () => {
  const mockUserId = 'user-1'
  const mockSession = { user: { id: mockUserId, email: 'test@example.com' } }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any)
  })

  describe('updateProfileAction', () => {
    it('successfully updates profile and invalidates cache', async () => {
      const updateData = { firstName: 'Jane', lastName: 'Doe' }
      
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ 
        id: mockUserId, 
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe' 
      } as any)
      
      vi.mocked(prisma.user.update).mockResolvedValue({ 
        id: mockUserId, 
        ...updateData,
        name: 'Jane Doe' 
      } as any)

      const result = await updateProfileAction(updateData)

      expect(result).toEqual({ success: true })
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: mockUserId },
        data: expect.objectContaining({ firstName: 'Jane' })
      }))
      expect(redisWriter.del).toHaveBeenCalled()
      expect(revalidatePath).toHaveBeenCalledWith('/profile')
    })
  })

  describe('cancelSubscriptionAction', () => {
    it('successfully schedules cancellation and notifies gateway', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: mockUserId,
        email: 'test@example.com',
        paddleSubscriptionId: 'sub-123',
        paddleSubscriptionStatus: SubscriptionStatus.ACTIVE
      } as any)

      server.use(
        http.post('*/internal/events', () => {
          return HttpResponse.json({ success: true })
        })
      )

      const result = await cancelSubscriptionAction()

      expect(result).toEqual({ success: true })
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { paddleCancellationScheduled: true }
      }))
      expect(redisWriter.del).toHaveBeenCalled()
    })

    it('reverts DB change if gateway notification fails', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: mockUserId,
        email: 'test@example.com',
        paddleSubscriptionId: 'sub-123',
        paddleSubscriptionStatus: SubscriptionStatus.ACTIVE
      } as any)

      server.use(
        http.post('*/internal/events', () => {
          return new HttpResponse(null, { status: 500 })
        })
      )

      const result = await cancelSubscriptionAction()

      expect(result.error).toBeDefined()
      // Should have been called twice: once to set true, once to revert to false
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { paddleCancellationScheduled: false }
      }))
    })
  })
})
