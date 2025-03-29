import { describe, it, expect } from 'vitest';
import { GET } from './route';

describe('API Route: /api/health', () => {
  it('should return a successful JSON response on GET', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ message: `API route test successful!` });
  });
});