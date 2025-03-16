import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import rateLimit from '@/config/rateLimit';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/public/')) {
    // @ts-ignore: req.ip might not be available in all environments
    const identifier = req.ip ?? '127.0.0.1';
    const isAllowed = await rateLimit.limit(identifier);

    if (!isAllowed.success) {
      return new NextResponse(null, {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  if (pathname.startsWith('/chat')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}
