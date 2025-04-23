import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';
import { SubscriptionStatus, type User } from '@prisma/client';

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

const mockUserId = 'user-usage-test';
const mockSession = { user: { id: mockUserId }, expires: 'never' };

const now = new Date();
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const yesterday = new Date(todayStart);
yesterday.setDate(todayStart.getDate() - 1);

const mockPremiumUser = {
    id: mockUserId,
    paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
    apiCallCountDaily: 50,
    lastApiCallReset: now,
};

const mockFreeUserUnderLimit = {
    id: mockUserId,
    paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
    apiCallCountDaily: 10,
    lastApiCallReset: now,
};

const mockFreeUserAtLimit = {
    id: mockUserId,
    paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
    apiCallCountDaily: 100,
    lastApiCallReset: now,
};

const mockFreeUserNeedsReset = {
    id: mockUserId,
    paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
    apiCallCountDaily: 90,
    lastApiCallReset: yesterday,
};

const mockFreeUserAtLimitNeedsReset = {
    id: mockUserId,
    paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
    apiCallCountDaily: 150, 
    lastApiCallReset: yesterday,
};

const mockFreeUserNullReset = {
    id: mockUserId,
    paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
    apiCallCountDaily: 20,
    lastApiCallReset: null,
};


describe('API Route: /api/user/usage/increment', () => {

    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('DAILY_API_LIMIT_FREE', '100');
        mockGetServerSession.mockResolvedValue(mockSession);
        mockPrismaUserFindUnique.mockResolvedValue(mockPremiumUser as any);
        mockPrismaUserUpdate.mockResolvedValue({ id: mockUserId } as any);
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

    it('should return 401 if user is not authenticated', async () => {
        mockGetServerSession.mockResolvedValue(null);
        await POST();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Not authenticated" }, { status: 401 });
        expect(mockPrismaUserFindUnique).not.toHaveBeenCalled();
        expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
    });

    it('should return 404 if user is not found', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(null);
        await POST();
        expect(mockPrismaUserFindUnique).toHaveBeenCalledWith({
            where: { id: mockUserId },
            select: {
                paddleSubscriptionStatus: true,
                apiCallCountDaily: true,
                lastApiCallReset: true,
            },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "User not found" }, { status: 404 });
        expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
    });

    it('should increment total and daily count for a premium user', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(mockPremiumUser as any);
        await POST();
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: {
                apiCallCountTotal: { increment: 1 },
                apiCallCountDaily: { increment: 1 },
            },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true }, { status: 200 });
    });

    it('should increment total and daily count for a free user under limit (no reset needed)', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(mockFreeUserUnderLimit as any);
        await POST();
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: {
                apiCallCountTotal: { increment: 1 },
                apiCallCountDaily: { increment: 1 },
            },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true }, { status: 200 });
    });

    it('should increment total and daily count for a free user under limit (reset needed)', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(mockFreeUserNeedsReset as any);
        await POST();
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: {
                apiCallCountTotal: { increment: 1 },
                apiCallCountDaily: { increment: 1 },
            },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true }, { status: 200 });
    });

    it('should increment total and daily count for a free user under limit (null reset date)', async () => {
        mockPrismaUserFindUnique.mockResolvedValue(mockFreeUserNullReset as any);
        await POST();
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: {
                apiCallCountTotal: { increment: 1 },
                apiCallCountDaily: { increment: 1 },
            },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true }, { status: 200 });
    });


    it('should increment only total count for a free user at limit (no reset needed)', async () => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockPrismaUserFindUnique.mockResolvedValue(mockFreeUserAtLimit as any);
        await POST();
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: {
                apiCallCountTotal: { increment: 1 },
            },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true }, { status: 200 });
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('reached daily limit'));
        consoleLogSpy.mockRestore();
    });

    it('should increment total AND daily count for a free user over limit when reset is needed', async () => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockPrismaUserFindUnique.mockResolvedValue(mockFreeUserAtLimitNeedsReset as any);
        await POST();
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: {
                apiCallCountTotal: { increment: 1 },
                apiCallCountDaily: { increment: 1 },
            },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true }, { status: 200 });
        expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('reached daily limit'));
        consoleLogSpy.mockRestore();
    });

     it('should use default daily limit if env var is missing or invalid', async () => {
         vi.stubEnv('DAILY_API_LIMIT_FREE', '');
         const userAtDefaultLimit = {
             ...mockFreeUserUnderLimit,
             apiCallCountDaily: 100
         };
        mockPrismaUserFindUnique.mockResolvedValue(userAtDefaultLimit as any);

        await POST();
        expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
            where: { id: mockUserId },
            data: {
                apiCallCountTotal: { increment: 1 },
            },
        });
        expect(mockNextResponseJson).toHaveBeenCalledWith({ success: true }, { status: 200 });
     });


    it('should return 500 if prisma findUnique fails', async () => {
        const dbError = new Error("Database findUnique error");
        mockPrismaUserFindUnique.mockRejectedValue(dbError);
        await POST();
        expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Failed to update usage" }, { status: 500 });
    });

    it('should return 500 if prisma update fails', async () => {
        const dbError = new Error("Database update error");
        mockPrismaUserFindUnique.mockResolvedValue(mockFreeUserUnderLimit as any);
        mockPrismaUserUpdate.mockRejectedValue(dbError);
        await POST();
        expect(mockPrismaUserUpdate).toHaveBeenCalled();
        expect(mockNextResponseJson).toHaveBeenCalledWith({ error: "Failed to update usage" }, { status: 500 });
    });
});