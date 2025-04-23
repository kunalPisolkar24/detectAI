import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended';
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, SubscriptionStatus } from '@prisma/client';
import { POST } from './route';
import * as paddleUtils from '@/utils/paddle';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: mockDeep<PrismaClient>(),
}));

vi.mock('@/utils/paddle', async (importOriginal) => {
    const original = await importOriginal<typeof paddleUtils>();
    return {
        ...original,
        validateSignature: vi.fn(),
    };
});

vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>();
  return {
    ...original,
    NextResponse: {
      ...original.NextResponse,
      json: vi.fn((body, init) => ({
        json: async () => body,
        status: init?.status || 200,
        headers: new Headers(init?.headers),
        ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
      }) as unknown as Response),
    },
  };
});


const prismaMock = prisma as DeepMockProxy<PrismaClient>;
const validateSignatureMock = vi.mocked(paddleUtils.validateSignature);
const nextResponseJsonMock = vi.mocked(NextResponse.json);

const MOCK_SECRET = 'test_webhook_secret';
const MOCK_USER_ID = 'user_clk_123abc';
const MOCK_SUBSCRIPTION_ID = 'sub_123xyz';
const MOCK_CUSTOMER_ID = 'cus_456def';
const MOCK_PLAN_ID_MONTHLY = 'price_1';
const MOCK_PLAN_ID_YEARLY = 'price_2';
const MOCK_SIGNATURE = 'ts=123,h1=abc';

const createMockRequest = (body: string | object, signature: string | null): NextRequest => {
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    const headers = new Headers();
    if (signature) {
        headers.set('Paddle-Signature', signature);
    }
    headers.set('Content-Type', 'application/json');

    const req = {
        headers,
        text: vi.fn().mockResolvedValue(bodyString),
        json: vi.fn().mockImplementation(async () => {
            if (typeof body === 'object') {
                return body;
            }
            try {
                return JSON.parse(bodyString);
            } catch (e) {
                 throw new SyntaxError(`Unexpected token in JSON at position 0`);
            }
        }),
        url: 'http://localhost/api/webhooks/paddle',
    } as unknown as NextRequest;

    return req;
};

describe('Paddle Webhook POST Handler', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    originalEnv = { ...process.env };
    process.env.PADDLE_WEBHOOK_SECRET = MOCK_SECRET;
    validateSignatureMock.mockResolvedValue(true);
    nextResponseJsonMock.mockImplementation((body, init) => ({
        body: body,
        status: init?.status || 200,
    }) as any);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return 400 if Paddle-Signature header is missing', async () => {
    const request = createMockRequest({}, null);
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { message: 'Missing Paddle signature' },
        { status: 400 }
    );
    expect(validateSignatureMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('should return 500 if PADDLE_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
    const request = createMockRequest({}, MOCK_SIGNATURE);
    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { error: 'Webhook secret not configured.' },
        { status: 500 }
    );
    expect(validateSignatureMock).not.toHaveBeenCalled();
  });

  it('should return 401 if signature validation fails', async () => {
    const body = JSON.stringify({ event_type: 'test' });
    validateSignatureMock.mockResolvedValue(false);
    const request = createMockRequest(body, MOCK_SIGNATURE);
    const response = await POST(request);

    expect(validateSignatureMock).toHaveBeenCalledWith(MOCK_SIGNATURE, body, MOCK_SECRET);
    expect(response.status).toBe(401);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { message: 'Invalid webhook signature!' },
        { status: 401 }
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('should return 400 if request body is not valid JSON', async () => {
    const invalidBody = 'this is not json';
    const request = createMockRequest(invalidBody, MOCK_SIGNATURE);

    validateSignatureMock.mockResolvedValue(true);
    nextResponseJsonMock.mockClear();

    const response = await POST(request);

    expect(validateSignatureMock).toHaveBeenCalledWith(MOCK_SIGNATURE, invalidBody, MOCK_SECRET);
    expect(response.status).toBe(400);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { error: 'Invalid JSON body.' },
        { status: 400 }
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

   it('should return 200 with error if userId is missing in custom_data', async () => {
    const eventPayload = {
      event_type: 'subscription.created',
      data: {
        id: MOCK_SUBSCRIPTION_ID,
        customer_id: MOCK_CUSTOMER_ID,
        status: 'active',
        items: [{ price: { id: MOCK_PLAN_ID_MONTHLY } }],
        current_billing_period: { ends_at: '2024-12-31T23:59:59Z' },
        custom_data: { }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
      { received: true, error: 'Missing userId' },
      { status: 200 }
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('should process subscription.created event correctly', async () => {
    const endsAt = new Date('2024-12-31T23:59:59Z');
    const eventPayload = {
      event_type: 'subscription.created',
      data: {
        id: MOCK_SUBSCRIPTION_ID,
        customer_id: MOCK_CUSTOMER_ID,
        status: 'active',
        items: [{ price: { id: MOCK_PLAN_ID_MONTHLY } }],
        current_billing_period: { ends_at: endsAt.toISOString() },
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    prismaMock.user.update.mockResolvedValue({} as any);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { message: 'Webhook processed successfully.' },
        { status: 200 }
    );
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: MOCK_USER_ID },
      data: {
        paddleCustomerId: MOCK_CUSTOMER_ID,
        paddleSubscriptionId: MOCK_SUBSCRIPTION_ID,
        paddlePlanId: MOCK_PLAN_ID_MONTHLY,
        paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndsAt: endsAt,
        paddleCancellationScheduled: false,
      },
    });
  });

  it('should process subscription.updated event correctly (status change)', async () => {
    const endsAt = new Date('2025-01-15T10:00:00Z');
    const eventPayload = {
      event_type: 'subscription.updated',
      data: {
        id: MOCK_SUBSCRIPTION_ID,
        customer_id: MOCK_CUSTOMER_ID,
        status: 'past_due',
        items: [{ price: { id: MOCK_PLAN_ID_YEARLY } }],
        current_billing_period: { ends_at: endsAt.toISOString() },
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    prismaMock.user.update.mockResolvedValue({} as any);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: MOCK_USER_ID },
      data: {
        paddleCustomerId: MOCK_CUSTOMER_ID,
        paddleSubscriptionId: MOCK_SUBSCRIPTION_ID,
        paddlePlanId: MOCK_PLAN_ID_YEARLY,
        paddleSubscriptionStatus: SubscriptionStatus.PAST_DUE,
        subscriptionEndsAt: endsAt,
        paddleCancellationScheduled: false,
      },
    });
  });

 it('should process subscription.updated event with scheduled cancellation correctly', async () => {
    const endsAtBillingPeriod = new Date('2024-11-30T23:59:59Z');
    const effectiveAtScheduledChange = new Date('2024-12-30T23:59:59Z');
    const eventPayload = {
      event_type: 'subscription.updated',
      data: {
        id: MOCK_SUBSCRIPTION_ID,
        customer_id: MOCK_CUSTOMER_ID,
        status: 'active',
        items: [{ price: { id: MOCK_PLAN_ID_MONTHLY } }],
        current_billing_period: { ends_at: endsAtBillingPeriod.toISOString() },
        scheduled_change: {
            action: 'cancel',
            effective_at: effectiveAtScheduledChange.toISOString(),
        },
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    prismaMock.user.update.mockResolvedValue({} as any);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const updateCallData = prismaMock.user.update.mock.calls[0]![0].data;
    expect(updateCallData).toEqual({
        paddleCustomerId: MOCK_CUSTOMER_ID,
        paddleSubscriptionId: MOCK_SUBSCRIPTION_ID,
        paddlePlanId: MOCK_PLAN_ID_MONTHLY,
        paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndsAt: endsAtBillingPeriod,
    });
    expect(updateCallData).not.toHaveProperty('paddleCancellationScheduled');
  });

   it('should process subscription.updated event resetting scheduled cancellation if action is not cancel', async () => {
    const endsAtBillingPeriod = new Date('2024-11-30T23:59:59Z');
    const effectiveAtScheduledChange = new Date('2024-12-31T23:59:59Z');
    const eventPayload = {
      event_type: 'subscription.updated',
      data: {
        id: MOCK_SUBSCRIPTION_ID,
        customer_id: MOCK_CUSTOMER_ID,
        status: 'active',
        items: [{ price: { id: MOCK_PLAN_ID_MONTHLY } }],
        current_billing_period: { ends_at: endsAtBillingPeriod.toISOString() },
        scheduled_change: {
            action: 'pause',
            effective_at: effectiveAtScheduledChange.toISOString(),
        },
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    prismaMock.user.update.mockResolvedValue({} as any);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const updateCallData = prismaMock.user.update.mock.calls[0]![0].data;
     expect(updateCallData).toEqual({
        paddleCustomerId: MOCK_CUSTOMER_ID,
        paddleSubscriptionId: MOCK_SUBSCRIPTION_ID,
        paddlePlanId: MOCK_PLAN_ID_MONTHLY,
        paddleSubscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndsAt: endsAtBillingPeriod,
        paddleCancellationScheduled: false,
    });
  });


  it('should return 200 with error if subscription.updated event misses required data', async () => {
    const eventPayload = {
      event_type: 'subscription.updated',
      data: {
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { received: true, error: "Missing subscription data for update" },
        { status: 200 }
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('should process subscription.canceled event correctly', async () => {
    const canceledAt = new Date('2024-10-31T12:00:00Z');
    const eventPayload = {
      event_type: 'subscription.canceled',
      data: {
        id: MOCK_SUBSCRIPTION_ID,
        customer_id: MOCK_CUSTOMER_ID,
        status: 'canceled',
        canceled_at: canceledAt.toISOString(),
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { message: 'Webhook processed successfully.' },
        { status: 200 }
    );
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: MOCK_USER_ID,
        paddleSubscriptionId: MOCK_SUBSCRIPTION_ID
      },
      data: {
        paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
        subscriptionEndsAt: canceledAt,
        paddleCancellationScheduled: false,
        paddleSubscriptionId: null,
        paddlePlanId: null,
      },
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('should return 200 with error if subscription.canceled event misses required data', async () => {
    const eventPayload = {
      event_type: 'subscription.canceled',
      data: {
        status: 'active',
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    const response = await POST(request);

    expect(response.status).toBe(200);
     expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { received: true, error: 'Missing/Invalid subscription data for cancel' },
        { status: 200 }
    );
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('should process transaction.completed event without db update', async () => {
    const eventPayload = {
      event_type: 'transaction.completed',
      data: {
        id: 'txn_abc',
        subscription_id: MOCK_SUBSCRIPTION_ID,
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { message: 'Webhook processed successfully.' },
        { status: 200 }
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('should process unhandled event types gracefully', async () => {
    const eventPayload = {
      event_type: 'customer.created',
      data: {
        id: MOCK_CUSTOMER_ID,
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { message: 'Webhook processed successfully.' },
        { status: 200 }
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('should return 500 if Prisma update throws an error', async () => {
    const endsAt = new Date('2024-12-31T23:59:59Z');
    const eventPayload = {
      event_type: 'subscription.created',
      data: {
        id: MOCK_SUBSCRIPTION_ID,
        customer_id: MOCK_CUSTOMER_ID,
        status: 'active',
        items: [{ price: { id: MOCK_PLAN_ID_MONTHLY } }],
        current_billing_period: { ends_at: endsAt.toISOString() },
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);
    const dbError = new Error('Database connection failed');
    prismaMock.user.update.mockRejectedValue(dbError);

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { error: 'Webhook processing failed.' },
        { status: 500 }
    );
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
  });

   it('should handle unknown Paddle status gracefully', async () => {
    const endsAt = new Date('2024-12-31T23:59:59Z');
    const eventPayload = {
      event_type: 'subscription.updated',
      data: {
        id: MOCK_SUBSCRIPTION_ID,
        customer_id: MOCK_CUSTOMER_ID,
        status: 'unknown_paddle_status',
        items: [{ price: { id: MOCK_PLAN_ID_MONTHLY } }],
        current_billing_period: { ends_at: endsAt.toISOString() },
        custom_data: { userId: MOCK_USER_ID }
      }
    };
    const request = createMockRequest(eventPayload, MOCK_SIGNATURE);

    const response = await POST(request);

    expect(response.status).toBe(200);
     expect(nextResponseJsonMock).toHaveBeenCalledWith(
        { received: true, error: "Missing subscription data for update" },
        { status: 200 }
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

});