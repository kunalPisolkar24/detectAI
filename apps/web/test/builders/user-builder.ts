import { User, SubscriptionStatus } from "@/lib/shared/generated/prisma/client"

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
  ...overrides,
})
