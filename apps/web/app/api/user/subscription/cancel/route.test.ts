import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';
import { SubscriptionStatus} from '@prisma/client'; 

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
const mockPrismaUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockPrismaUserUpdate = vi.mocked(prisma.user.update);
const mockNextResponseJson = vi.mocked(NextResponse.json);

const mockUserId = 'user-cancel-test';
const mockSubscriptionId = 'sub_12345abcde';
const mockSession = { user: { id: mockUserId }, expires: 'never' };

const mockActiveUser = {
    id: mockUserId,
    paddleSubscriptionId: mockSubscriptionId,
    paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
};

const mockTrialingUser = {
    id: mockUserId,
    paddleSubscriptionId: mockSubscriptionId,
    paddleSubscriptionStatus: SubscriptionStatus.TRIALING,
};

const mockCancelledUser = {
    id: mockUserId,
    paddleSubscriptionId: mockSubscriptionId,
    paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
};

const mockUserNoSubId = {
    id: mockUserId,
    paddleSubscriptionId: null,
    paddleSubscriptionStatus: null,
};

const mockUpdatedUserResult = {
    id: mockUserId,
    paddleCancellationScheduled: true,
    name: null, email: 'test@example.com', emailVerified: null, image: null,
    firstName: null, lastName: null, password: null, createdAt: new Date(), updatedAt: new Date(),
    apiCallCountDaily: 0, apiCallCountTotal: 0, lastApiCallReset: null,
    paddleCustomerId: null, paddlePlanId: null, paddleSubscriptionId: mockSubscriptionId,
    paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
    subscriptionEndsAt: null,
};


global.fetch = vi.fn();
const mockFetch = vi.mocked(fetch);

describe('API Route: /api/user/subscription/cancel', () => {

    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
        vi.stubEnv('PADDLE_API_KEY', 'test-api-key');
        mockGetServerSession.mockResolvedValue(mockSession);
        mockPrismaUserFindUnique.mockResolvedValue(mockActiveUser as any);
        mockPrismaUserUpdate.mockResolvedValue(mockUpdatedUserResult as any);
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: { status: 'canceled', scheduled_change: { action: 'cancel', occurs_at: '...' } } }),
        } as Response);
        mockNextResponseJson.mockImplementation((body, init) => ({
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

    const expectedPaddleUrl = `https://sandbox-api.paddle.com/subscriptions/${mockSubscriptionId}/cancel`;
    const expectedFetchOptions = {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    };

    it('should return 401 if user is not authenticated', async () => {
        mockGetServerSession.mockResolvedValue(null);
        await POST();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Not authenticated" }, { status: 401 });
        expect(mockPrismaUserFindUnique).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return 404 if user is not found', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(null);
        await POST();
        expect(mockPrismaUserFindUnique).toHaveBeenCalledWith({
            where: { id: mockUserId },
            select: { paddleSubscriptionId: true, paddleSubscriptionStatus: true },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Subscription details not found for user." }, { status: 404 });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return 404 if user has no subscription ID', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(mockUserNoSubId as any); 
        await POST();
        expect(mockPrismaUserFindUnique).toHaveBeenCalledWith({
            where: { id: mockUserId },
            select: { paddleSubscriptionId: true, paddleSubscriptionStatus: true },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Subscription details not found for user." }, { status: 404 });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return 400 if subscription is not ACTIVE or TRIALING', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(mockCancelledUser as any); 
        await POST();
        expect(mockPrismaUserFindUnique).toHaveBeenCalled();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Subscription is not active or already canceled." }, { status: 400 });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should successfully schedule cancellation for an ACTIVE subscription', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(mockActiveUser as any); 
        await POST();
        expect(mockPrismaUserFindUnique).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(expectedPaddleUrl, expectedFetchOptions);
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: { paddleCancellationScheduled: true },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true, message: "Subscription cancellation scheduled." }, { status: 200 });
    });

     it('should successfully schedule cancellation for a TRIALING subscription', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(mockTrialingUser as any);
        await POST();
        expect(mockPrismaUserFindUnique).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(expectedPaddleUrl, expectedFetchOptions);
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: { paddleCancellationScheduled: true },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true, message: "Subscription cancellation scheduled." }, { status: 200 });
    });

    it('should return error response from Paddle API if cancellation fails', async () => {
        const paddleErrorDetail = 'Subscription cannot be canceled in its current state.';
        mockFetch.mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ error: { code: 'sub_invalid_state', detail: paddleErrorDetail } }),
        } as Response);

        await POST();
        expect(mockFetch).toHaveBeenCalledWith(expectedPaddleUrl, expectedFetchOptions);
        expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: paddleErrorDetail }, { status: 400 });
    });

    it('should return generic error if Paddle API fails without specific detail', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({ error: { code: 'service_unavailable' } }),
        } as Response);

        await POST();
        expect(mockFetch).toHaveBeenCalledWith(expectedPaddleUrl, expectedFetchOptions);
        expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Failed to schedule subscription cancellation with payment provider." }, { status: 503 });
    });


    it('should return 500 if prisma findUnique fails', async () => {
        const dbError = new Error("Database findUnique error");
        mockPrismaUserFindUnique.mockRejectedValue(dbError);
        await POST();
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Internal server error during cancellation request." }, { status: 500 });
    });

    it('should return 500 if fetch call itself throws an error', async () => {
        const fetchError = new Error("Network error");
        mockFetch.mockRejectedValue(fetchError);
        await POST();
        expect(mockFetch).toHaveBeenCalledWith(expectedPaddleUrl, expectedFetchOptions);
        expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Internal server error during cancellation request." }, { status: 500 });
    });

     it('should return 500 if prisma update fails after successful Paddle call', async () => {
        const dbUpdateError = new Error("Database update error");
        mockPrismaUserUpdate.mockRejectedValue(dbUpdateError);

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: { status: 'canceled'} }),
        } as Response);

        mockPrismaUserFindUnique.mockResolvedValue(mockActiveUser as any);

        await POST();

        expect(mockFetch).toHaveBeenCalledWith(expectedPaddleUrl, expectedFetchOptions);
        expect(mockPrismaUserUpdate).toHaveBeenCalled();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Internal server error during cancellation request." }, { status: 500 });
    });
});