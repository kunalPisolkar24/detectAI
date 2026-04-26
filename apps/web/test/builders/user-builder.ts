import { User, SubscriptionStatus } from "@/lib/generated/prisma"

export const createUser = (overrides: Partial<User> = {}): User => ({
  id: "test-user-id",
  name: "Test User",
  email: "test@example.com",
  emailVerified: null,
  image: null,
  firstName: "Test",
  lastName: "User",
  password: "hashed-password",
  createdAt: new Date(),
  updatedAt: new Date(),
  paddleCustomerId: null,
  paddleSubscriptionId: null,
  paddlePlanId: null,
  paddleSubscriptionStatus: null,
  subscriptionEndsAt: null,
  paddleCancellationScheduled: false,
  apiCallCountDaily: 0,
  lastApiCallReset: null,
  apiCallCountTotal: 0,
  ...overrides,
})
