import { setupServer } from 'msw/node'
import { authHandlers } from './handlers/auth-handlers'
import { chatHandlers } from './handlers/chat-handlers'

export const handlers = [
  ...authHandlers,
  ...chatHandlers
]

export const server = setupServer(...handlers)
