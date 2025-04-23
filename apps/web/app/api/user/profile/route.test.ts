import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET, PUT, UserProfileData } from './route';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';
import { SubscriptionStatus } from '@prisma/client';

vi.mock('next-auth/next');
vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock('next/server', async (importOriginal) => {
    const actual = await importOriginal() as typeof import('next/server');
    return {
        ...actual,
        NextResponse: {
            ...actual.NextResponse,
            json: vi.fn((body, init) => ({
                json: async () => body,
                status: init?.status || 200,
                headers: new Headers(init?.headers),
                ok: (init?.status || 200) >= 200 && (init?.status || 200) < 300,
                statusText: `Status ${init?.status || 200}`
            })),
        }
    };
});

const mockGetServerSession = vi.mocked(getServerSession);
const mockPrisma = prisma as unknown as {
    user: {
        findUnique: ReturnType<typeof vi.fn>,
        update: ReturnType<typeof vi.fn>
    }
};
const mockNextResponse = NextResponse as unknown as {
    json: ReturnType<typeof vi.fn>
};

const mockUserId = 'user-123-test';
const mockUserEmail = 'test@example.com';
const now = new Date();
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const yesterday = new Date(todayStart);
yesterday.setDate(todayStart.getDate() - 1);

const baseMockUser = {
  id: mockUserId,
  email: mockUserEmail,
  firstName: 'Test',
  lastName: 'User',
  name: 'Test User',
  createdAt: new Date('2023-01-01T10:00:00Z'),
  updatedAt: new Date('2023-10-10T10:00:00Z'),
  apiCallCountDaily: 10,
  apiCallCountTotal: 1000,
  lastApiCallReset: now,
  paddleSubscriptionId: null,
  paddleSubscriptionStatus: null,
  paddlePlanId: null,
  subscriptionEndsAt: null,
  paddleCancellationScheduled: false,
  accounts: [
    { id: 'acc-1', userId: mockUserId, provider: 'google', providerAccountId: 'google-acc-id', type: 'oauth' },
  ],
};

const premiumMockUser = {
  ...baseMockUser,
  paddleSubscriptionId: 'sub_123',
  paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
  paddlePlanId: 'plan_premium',
  subscriptionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  paddleCancellationScheduled: true,
};

const freeUserNeedsReset = {
    ...baseMockUser,
    lastApiCallReset: yesterday,
    apiCallCountDaily: 50,
};

const mockSession = {
  user: { id: mockUserId, email: mockUserEmail, name: 'Test User' },
  expires: 'never',
};

const createMockPutRequest = (body: unknown): NextRequest => {
    const request = new NextRequest('http://localhost/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }
    });
    request.json = async () => body as any;
    return request;
};

describe('API Route: /api/user/profile', () => {

    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('DAILY_API_LIMIT_FREE', '100');
        mockGetServerSession.mockResolvedValue(mockSession);
        mockPrisma.user.findUnique.mockResolvedValue({ ...baseMockUser }); 
        mockPrisma.user.update.mockResolvedValue({
            id: mockUserId,
            firstName: 'Updated',
            lastName: 'User',
            name: 'Updated User',
            updatedAt: new Date(),
        });
         mockNextResponse.json.mockImplementation((body, init) => ({
             json: async () => body,
             status: init?.status || 200,
             headers: new Headers(init?.headers),
             ok: (init?.status || 200) >= 200 && (init?.status || 200) < 300,
             statusText: `Status ${init?.status || 200}`
         }) as any);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    describe('GET', () => {
        it('should return 401 if user is not authenticated', async () => {
            mockGetServerSession.mockResolvedValue(null);
            await GET();
            expect(mockNextResponse.json).toHaveBeenCalledWith({ error: "Not authenticated" }, { status: 401 });
            expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        });

        it('should return 404 if user is not found', async () => {
            mockPrisma.user.findUnique.mockResolvedValue(null);
            await GET();
            expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
                where: { id: mockUserId },
                include: expect.any(Object)
            });
            expect(mockNextResponse.json).toHaveBeenCalledWith({ error: "User not found" }, { status: 404 });
        });

        it('should return profile data for a free user (no reset needed)', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...baseMockUser, paddleSubscriptionStatus: SubscriptionStatus.CANCELED });
            await GET();
            const expectedProfileData: Partial<UserProfileData> = {
                id: mockUserId,
                firstName: baseMockUser.firstName,
                lastName: baseMockUser.lastName,
                email: mockUserEmail,
                memberSince: baseMockUser.createdAt,
                isPremium: false,
                premiumPlanId: null,
                premiumExpiry: null,
                subscriptionStatus: SubscriptionStatus.CANCELED,
                paddleSubscriptionId: null,
                isCancellationScheduled: false,
                connectedAccounts: expect.any(Array),
                usage: {
                    apiCalls: {
                        current: baseMockUser.apiCallCountDaily,
                        limit: 100,
                        period: "Daily",
                    },
                    totalApiCallCount: baseMockUser.apiCallCountTotal,
                },
            };
            expect(mockNextResponse.json).toHaveBeenCalledWith(expect.objectContaining(expectedProfileData), { status: 200 });
            expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('should return profile data for a premium user', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...premiumMockUser });
            await GET();
            const expectedProfileData: Partial<UserProfileData> = {
                id: mockUserId,
                isPremium: true,
                premiumPlanId: premiumMockUser.paddlePlanId,
                premiumExpiry: premiumMockUser.subscriptionEndsAt,
                subscriptionStatus: premiumMockUser.paddleSubscriptionStatus,
                paddleSubscriptionId: premiumMockUser.paddleSubscriptionId,
                isCancellationScheduled: premiumMockUser.paddleCancellationScheduled,
                usage: {
                    apiCalls: {
                        current: premiumMockUser.apiCallCountDaily,
                        limit: null,
                        period: "Daily",
                    },
                    totalApiCallCount: premiumMockUser.apiCallCountTotal,
                },
            };
            expect(mockNextResponse.json).toHaveBeenCalledWith(expect.objectContaining(expectedProfileData), { status: 200 });
            expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('should reset daily count and return profile data if last reset was before today', async () => {
            const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockPrisma.user.findUnique.mockResolvedValue({ ...freeUserNeedsReset });
            mockPrisma.user.update.mockResolvedValue({ id: mockUserId } as any);

            await GET();

            const expectedProfileData: Partial<UserProfileData> = {
                isPremium: false,
                usage: {
                    apiCalls: {
                        current: 0,
                        limit: 100,
                        period: "Daily",
                    },
                    totalApiCallCount: freeUserNeedsReset.apiCallCountTotal, 
                },
            };
            expect(mockNextResponse.json).toHaveBeenCalledWith(expect.objectContaining(expectedProfileData), { status: 200 });
            expect(mockPrisma.user.update).toHaveBeenCalledWith({
                where: { id: mockUserId },
                data: {
                    apiCallCountDaily: 0,
                    lastApiCallReset: expect.any(Date),
                },
            });
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(`Resetting daily API count for user ${mockUserId}`));
            consoleLogSpy.mockRestore();
            consoleErrorSpy.mockRestore();
        });

         it('should handle failure during background daily count reset', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockPrisma.user.findUnique.mockResolvedValue({ ...freeUserNeedsReset });
            const updateError = new Error("DB update failed");
            mockPrisma.user.update.mockRejectedValue(updateError);

            const response = await GET();
            const responseBody = await (response as any).json(); 

            expect(responseBody.usage.apiCalls.current).toBe(0); 
            expect(responseBody.usage.apiCalls.limit).toBe(100);
            expect(responseBody.usage.totalApiCallCount).toBe(freeUserNeedsReset.apiCallCountTotal);
            expect((response as any).status).toBe(200);

            expect(mockPrisma.user.update).toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(`Failed to update daily API reset for user ${mockUserId}`), updateError);
            consoleErrorSpy.mockRestore();
         });


        it('should return 500 if database fetch fails', async () => {
            const dbError = new Error("Database connection failed");
            mockPrisma.user.findUnique.mockRejectedValue(dbError);
            await GET();
            expect(mockNextResponse.json).toHaveBeenCalledWith({ error: "Failed to fetch profile data" }, { status: 500 });
        });
    });

    describe('PUT', () => {

         const updatePayload = { firstName: "Updated" };
         const updatePayloadBoth = { firstName: "NewFirst", lastName: "NewLast" };

        it('should return 401 if user is not authenticated', async () => {
            mockGetServerSession.mockResolvedValue(null);
            const request = createMockPutRequest(updatePayload);
            await PUT(request);
            expect(mockNextResponse.json).toHaveBeenCalledWith({ error: "Not authenticated" }, { status: 401 });
            expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('should return 400 for invalid input data', async () => {
             const invalidPayload = { firstName: "" };
             const request = createMockPutRequest(invalidPayload);
             await PUT(request);
             expect(mockNextResponse.json).toHaveBeenCalledWith(
                 expect.objectContaining({ error: "Invalid input", details: expect.any(Object) }),
                 { status: 400 }
             );
             expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

         it('should return 400 for invalid input data (extra fields)', async () => {
             const invalidPayload = { firstName: "Valid", email: "bad@email.com" };
             const request = createMockPutRequest(invalidPayload);
             await PUT(request);
             expect(mockNextResponse.json).toHaveBeenCalledWith(
                 expect.objectContaining({ error: "Invalid input", details: expect.any(Object) }),
                 { status: 400 }
             );
             expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('should return 400 if no fields are provided for update', async () => {
            const request = createMockPutRequest({});
            await PUT(request);
            expect(mockNextResponse.json).toHaveBeenCalledWith({ message: "No fields provided for update." }, { status: 400 });
            expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('should update user profile successfully (firstName only)', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...baseMockUser });
            const request = createMockPutRequest({ firstName: "UpdatedFirst" });
            const expectedUpdateData = {
                firstName: "UpdatedFirst",
                name: "UpdatedFirst User"
            };
             const mockUpdatedUser = {
                 id: mockUserId,
                 firstName: "UpdatedFirst",
                 lastName: baseMockUser.lastName,
                 name: "UpdatedFirst User",
                 updatedAt: new Date()
             };
             mockPrisma.user.update.mockResolvedValue(mockUpdatedUser);

            await PUT(request);

            expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: mockUserId }, select: { firstName: true, lastName: true } });
            expect(mockPrisma.user.update).toHaveBeenCalledWith({
                where: { id: mockUserId },
                data: expectedUpdateData,
                select: expect.any(Object)
            });
            expect(mockNextResponse.json).toHaveBeenCalledWith(mockUpdatedUser, { status: 200 });
        });

        it('should update user profile successfully (lastName only)', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...baseMockUser });
            const request = createMockPutRequest({ lastName: "UpdatedLast" });
            const expectedUpdateData = {
                lastName: "UpdatedLast",
                name: "Test UpdatedLast"
            };
            const mockUpdatedUser = {
                id: mockUserId,
                firstName: baseMockUser.firstName,
                lastName: "UpdatedLast",
                name: "Test UpdatedLast",
                updatedAt: new Date()
            };
            mockPrisma.user.update.mockResolvedValue(mockUpdatedUser);

            await PUT(request);

            expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: mockUserId }, select: { firstName: true, lastName: true } });
            expect(mockPrisma.user.update).toHaveBeenCalledWith({
                where: { id: mockUserId },
                data: expectedUpdateData,
                select: expect.any(Object)
            });
            expect(mockNextResponse.json).toHaveBeenCalledWith(mockUpdatedUser, { status: 200 });
        });


        it('should update user profile successfully (both names)', async () => {
             mockPrisma.user.findUnique.mockResolvedValue({ ...baseMockUser });
             const request = createMockPutRequest(updatePayloadBoth);
             const expectedUpdateData = {
                 firstName: "NewFirst",
                 lastName: "NewLast",
                 name: "NewFirst NewLast"
             };
             const mockUpdatedUser = {
                 id: mockUserId,
                 firstName: "NewFirst",
                 lastName: "NewLast",
                 name: "NewFirst NewLast",
                 updatedAt: new Date()
             };
             mockPrisma.user.update.mockResolvedValue(mockUpdatedUser);

             await PUT(request);

             expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: mockUserId }, select: { firstName: true, lastName: true } });
             expect(mockPrisma.user.update).toHaveBeenCalledWith({
                 where: { id: mockUserId },
                 data: expectedUpdateData,
                 select: expect.any(Object)
             });
             expect(mockNextResponse.json).toHaveBeenCalledWith(mockUpdatedUser, { status: 200 });
        });


        it('should return 500 if database update fails', async () => {
            const dbError = new Error("Database update failed");
            mockPrisma.user.update.mockRejectedValue(dbError);
            mockPrisma.user.findUnique.mockResolvedValue({ ...baseMockUser });
            const request = createMockPutRequest(updatePayload);

            await PUT(request);

            expect(mockPrisma.user.update).toHaveBeenCalled();
            expect(mockNextResponse.json).toHaveBeenCalledWith({ error: "Failed to update profile" }, { status: 500 });
        });

         it('should return 500 if findUnique for name derivation fails', async () => {
             const dbError = new Error("Database findUnique failed");
             mockPrisma.user.findUnique.mockRejectedValue(dbError);
             const request = createMockPutRequest({ firstName: "UpdatedFirst" });

             await PUT(request);

             expect(mockPrisma.user.findUnique).toHaveBeenCalled();
             expect(mockPrisma.user.update).not.toHaveBeenCalled();
             expect(mockNextResponse.json).toHaveBeenCalledWith({ error: "Failed to update profile" }, { status: 500 });
        });

        it('should return 500 if request body parsing fails', async () => {
            const request = new NextRequest('http://localhost/api/user/profile', {
                method: 'PUT',
                body: '{"malformed json"',
                headers: { 'Content-Type': 'application/json' }
            });
            request.json = async () => { throw new SyntaxError("Bad JSON") };

            await PUT(request);
            expect(mockNextResponse.json).toHaveBeenCalledWith({ error: "Failed to update profile" }, { status: 500 });
         });
    });
});