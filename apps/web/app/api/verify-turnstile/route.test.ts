// apps/web/api/verify-turnstile/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_SECRET = 'mock-turnstile-secret-key';

const createMockRequest = (body: any): NextRequest => {
    const request = new NextRequest('http://localhost/api/verify-turnstile', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }
    });
    request.json = async () => body;
    return request;
};

describe('API Route: /api/verify-turnstile', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        vi.stubEnv('TURNSTILE_SECRET_KEY', MOCK_SECRET); // Stub before each test
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return success if turnstile token is valid', async () => {
        const mockToken = 'valid-token';
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), { status: 200 })
        );

        const request = createMockRequest({ token: mockToken });
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toEqual({ success: true });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            expect.objectContaining({
                method: 'POST',
            })
        );
        // Simple check for FormData content - more complex checks are possible but verbose
        
        const fetchOptions = mockFetch.mock.calls[0]![1];
        expect(fetchOptions.body).toBeInstanceOf(FormData);
        expect(fetchOptions.body.get('secret')).toBe(MOCK_SECRET);
        expect(fetchOptions.body.get('response')).toBe(mockToken);
    });

    it('should return 401 if turnstile token is invalid', async () => {
        const mockToken = 'invalid-token';
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify({ success: false }), { status: 200 })
        );

        const request = createMockRequest({ token: mockToken });
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: 'Invalid Turnstile token' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return 400 if turnstile token is missing', async () => {
        const request = createMockRequest({}); // No token
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toEqual({ error: 'Turnstile token is required' });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return 500 if TURNSTILE_SECRET_KEY is not set', async () => {
        vi.stubEnv('TURNSTILE_SECRET_KEY', ''); // Unset the key for this test

        const request = createMockRequest({ token: 'any-token' });
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body).toEqual({ error: 'Internal server error' });
        expect(mockFetch).not.toHaveBeenCalled();
    });

     it('should return 500 if fetch to Cloudflare fails', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));

        const request = createMockRequest({ token: 'any-token' });
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body).toEqual({ error: 'Internal server error' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return 500 if request body is invalid json', async () => {
         const request = new NextRequest('http://localhost/api/verify-turnstile', {
             method: 'POST',
             body: 'not json', // Invalid body
             headers: { 'Content-Type': 'application/json' }
         });
         // Don't mock request.json, let it throw implicitly

         const response = await POST(request);
         const body = await response.json();

         expect(response.status).toBe(500);
         expect(body).toEqual({ error: 'Internal server error' });
         expect(mockFetch).not.toHaveBeenCalled();
    });
});