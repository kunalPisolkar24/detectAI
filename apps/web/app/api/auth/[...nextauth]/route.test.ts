import { describe, it, expect, vi } from 'vitest';
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/authOptions';

vi.mock('next-auth', () => ({
  default: vi.fn()
}));

vi.mock('@/lib/authOptions', () => ({
  authOptions: { 
    providers: [],
    session: { strategy: 'jwt' },
    callbacks: {},
    pages: {} 
  }
}));

describe('NextAuth API Route', () => {
  it('should initialize NextAuth with authOptions', async () => {
    // Import the route directly to trigger NextAuth
    await import('@/app/api/auth/[...nextauth]/route');
    
    expect(NextAuth).toHaveBeenCalledWith(authOptions);
  });
});