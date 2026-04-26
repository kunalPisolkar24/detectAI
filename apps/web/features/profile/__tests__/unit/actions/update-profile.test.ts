import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateProfileAction } from '../../../actions/update-profile'
import { getServerSession } from 'next-auth'
import { userService } from '@/features/auth/services/user-service'
import { revalidatePath } from 'next/cache'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/features/auth/services/user-service', () => ({
  userService: {
    updateUser: vi.fn(),
  },
}))

vi.mock('@/lib/config/auth-options', () => ({
  authOptions: {},
}))

describe('updateProfileAction', () => {
  const mockUserId = 'user-123'
  const mockValues = { firstName: 'Jane', lastName: 'Doe' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error if unauthorized', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await updateProfileAction(mockValues)
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('returns error if validation fails', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: mockUserId } } as any)
    const result = await updateProfileAction({ firstName: '', lastName: '' })
    expect(result).toEqual({ error: 'Invalid input' })
  })

  it('successfully updates profile', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: mockUserId } } as any)
    vi.mocked(userService.updateUser).mockResolvedValue({} as any)

    const result = await updateProfileAction(mockValues)

    expect(userService.updateUser).toHaveBeenCalledWith(mockUserId, {
      firstName: 'Jane',
      lastName: 'Doe',
      name: 'Jane Doe',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/profile')
    expect(result).toEqual({ success: true })
  })

  it('handles service errors', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: mockUserId } } as any)
    vi.mocked(userService.updateUser).mockRejectedValue(new Error('Update failed'))

    const result = await updateProfileAction(mockValues)
    expect(result).toEqual({ error: 'Failed to update profile' })
  })
})
