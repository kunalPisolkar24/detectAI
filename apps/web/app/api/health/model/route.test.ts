
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './route';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock environment variables
const MOCK_URL = 'http://mock-model.local/health';
const MOCK_SECRET = 'test-secret';
vi.stubEnv('NEXT_PUBLIC_MODEL_URL', MOCK_URL);
vi.stubEnv('NEXT_PUBLIC_MODEL_API_SECRET', MOCK_SECRET);


describe('API Route: /api/health (External Fetch)', () => {

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch); // Re-stub fetch after reset
    vi.stubEnv('NEXT_PUBLIC_MODEL_URL', MOCK_URL);
    vi.stubEnv('NEXT_PUBLIC_MODEL_API_SECRET', MOCK_SECRET);
  });

  afterEach(() => {
    // Restore mocks after each test
    vi.restoreAllMocks();
  });

  it('should return data from the model health endpoint on success', async () => {
    const mockData = { modelStatus: 'OK', dependencies: 'OK' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await GET({} as Request); // Pass dummy request object
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
        `${MOCK_URL}/health`,
        expect.objectContaining({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MOCK_SECRET}`,
            },
        })
    );
  });

  it('should return an error response if the model health fetch fails', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Model service unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await GET({} as Request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'Failed to fetch health data' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should return a 500 error if fetch throws an exception', async () => {
    mockFetch.mockRejectedValue(new Error('Network connection refused'));

    const response = await GET({} as Request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'An error occurred while processing your request' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});