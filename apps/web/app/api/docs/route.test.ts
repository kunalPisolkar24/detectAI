import { describe, it, expect } from 'vitest';
import { GET } from './route';
import swaggerSpec from '@/lib/swagger';

describe('API Route: /api/docs', () => {
  it('should return the swagger spec JSON with correct CORS headers', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(swaggerSpec);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});