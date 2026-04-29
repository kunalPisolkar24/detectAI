import { vi, beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './msw-server'
import { setupEnvMocks } from './infrastructure/env'
import { setupCommonMocks } from './infrastructure/common'
import { setupMetricsMocks } from './infrastructure/metrics'
import { setupRedisMocks } from './infrastructure/redis'
import { setupPrismaMocks } from './infrastructure/prisma'

// Apply modular mocks
setupEnvMocks()
setupCommonMocks()
setupMetricsMocks()
setupRedisMocks()
setupPrismaMocks()

// MSW Server Lifecycle
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
