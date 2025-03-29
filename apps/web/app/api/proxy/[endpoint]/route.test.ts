import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextRequest} from 'next/server';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_URL = 'http://mock-model.local';
const MOCK_SECRET = 'test-secret-proxy';
vi.stubEnv('NEXT_PUBLIC_MODEL_URL', MOCK_URL);
vi.stubEnv('NEXT_PUBLIC_MODEL_API_SECRET', MOCK_SECRET);

describe('API Route: /api/proxy/[endpoint]', () => {
  const endpoint = 'classify';
  const requestBody = { text: 'Test input' };
  const mockSuccessData = { prediction: 'positive', confidence: 0.95 };

  // Helper to create a mock NextRequest
  const createMockRequest = (body: any, path: string): NextRequest => {
    const url = `http://localhost/${path}`;
    const request = new NextRequest(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }
    });
    // Mock the json() method explicitly as it might not work correctly on the base Request
    request.json = async () => body;
    return request;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('NEXT_PUBLIC_MODEL_URL', MOCK_URL);
    vi.stubEnv('NEXT_PUBLIC_MODEL_API_SECRET', MOCK_SECRET);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should proxy the request and return prediction data on success', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(mockSuccessData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const mockRequest = createMockRequest(requestBody, `api/proxy/${endpoint}`);
    const response = await POST(mockRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(mockSuccessData);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `${MOCK_URL}/predict/${endpoint}`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MOCK_SECRET}`,
        },
        body: JSON.stringify(requestBody),
      })
    );
  });

  it('should return 500 if the external fetch fails (e.g., non-JSON response)', async () => {
     // Simulate fetch succeeding but response.json() failing
     const badResponse = new Response('Internal Server Error', { status: 500 });
     mockFetch.mockResolvedValue(badResponse);

    const mockRequest = createMockRequest(requestBody, `api/proxy/${endpoint}`);
    const response = await POST(mockRequest);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to fetch prediction' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should return 500 if the external fetch throws an exception', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const mockRequest = createMockRequest(requestBody, `api/proxy/${endpoint}`);
    const response = await POST(mockRequest);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to fetch prediction' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

   it('should correctly extract endpoint from URL', async () => {
    const specificEndpoint = 'summarize';
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ summary: 'ok' }), { status: 200 })
    );

    const mockRequest = createMockRequest({ data: 'long text' }, `api/proxy/${specificEndpoint}`);
    await POST(mockRequest);

    expect(mockFetch).toHaveBeenCalledWith(
      `${MOCK_URL}/predict/${specificEndpoint}`, // Verifies correct endpoint use
      expect.anything()
    );
  });
});