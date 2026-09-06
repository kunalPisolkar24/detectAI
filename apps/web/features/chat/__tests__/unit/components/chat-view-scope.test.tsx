import { render, waitFor } from '@/test/test-utils'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '../../../components/chat-view'
import { useChatUIStore } from '../../../stores/ui-store'
import React from 'react'

const sessionFor = (id: string) =>
  ({
    data: {
      user: { id, name: 'Test User', email: `${id}@example.com` },
      expires: '9999-12-31T23:59:59.999Z',
    },
    status: 'authenticated',
    update: vi.fn(),
  }) as any

describe('ChatView user scope reset', () => {
  let captured: QueryClient | null = null
  const Probe = () => {
    captured = useQueryClient()
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    captured = null
    window.localStorage.clear()
  })

  it('clears the selection and cached chats when the signed-in user changes', async () => {
    vi.mocked(useSession).mockReturnValue(sessionFor('user-a'))
    useChatUIStore.getState().setCurrentChatId('chat-1')

    const view = render(
      <>
        <Probe />
        <ChatView />
      </>,
    )
    expect(captured).not.toBeNull()

    captured!.setQueryData(['chat-history'], [{ id: 'chat-1', title: 'Old chat' }])
    captured!.setQueryData(['chat', 'chat-1'], { id: 'chat-1', messages: [] })
    expect(useChatUIStore.getState().currentChatId).toBe('chat-1')

    vi.mocked(useSession).mockReturnValue(sessionFor('user-b'))
    view.rerender(
      <>
        <Probe />
        <ChatView />
      </>,
    )

    await waitFor(() => {
      expect(useChatUIStore.getState().currentChatId).toBeNull()
    })
    await waitFor(() => {
      expect(captured!.getQueryData(['chat-history'])).toBeUndefined()
      expect(captured!.getQueryData(['chat', 'chat-1'])).toBeUndefined()
    })
  })

  it('keeps state when the session user is unchanged', async () => {
    vi.mocked(useSession).mockReturnValue(sessionFor('user-a'))
    useChatUIStore.getState().setCurrentChatId('chat-1')

    const view = render(
      <>
        <Probe />
        <ChatView />
      </>,
    )
    captured!.setQueryData(['chat-history'], [{ id: 'chat-1', title: 'Old chat' }])

    view.rerender(
      <>
        <Probe />
        <ChatView />
      </>,
    )

    expect(useChatUIStore.getState().currentChatId).toBe('chat-1')
    expect(captured!.getQueryData(['chat-history'])).toEqual([{ id: 'chat-1', title: 'Old chat' }])
  })
})
