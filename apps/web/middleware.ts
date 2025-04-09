import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import rateLimit from "@/config/rateLimit";

const secret = process.env.NEXTAUTH_SECRET;

const PUBLIC_ONLY_PATHS = ['/', '/login', '/signup'];
const PROTECTED_PATHS = ['/chat', '/profile'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // @ts-ignore
  const ip = req.ip ?? "127.0.0.1";

  console.log(`[Middleware] Path: ${pathname}, IP: ${ip}`);

  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/auth/') || // Allow NextAuth API routes
    pathname.startsWith('/public/') ||
    pathname.includes('.') // Generally allows files like favicon.ico, etc.
  ) {
    return NextResponse.next();
  }

  if (!secret) {
     console.error("[Middleware] ERROR: NEXTAUTH_SECRET is not defined!");
     if (!pathname.startsWith('/auth/error')) {
       const url = req.nextUrl.clone();
       url.pathname = "/auth/error?error=ConfigurationError";
       return NextResponse.redirect(url);
     }
     return NextResponse.next(); // Allow access to error page if secret missing
  }

  const token = await getToken({ req, secret });
  const isLoggedIn = !!token;

  const isPublicOnlyPath = PUBLIC_ONLY_PATHS.includes(pathname);

  if (isPublicOnlyPath && isLoggedIn) {
    console.log(`[Middleware] Logged-in user accessing public-only path ${pathname}. Redirecting to /chat.`);
    const url = req.nextUrl.clone();
    url.pathname = "/chat";
    url.search = '';
    return NextResponse.redirect(url);
  }

  const isProtectedPath = PROTECTED_PATHS.some(path => pathname.startsWith(path));

  if (isProtectedPath && !isLoggedIn) {
    console.log(`[Middleware] Logged-out user accessing protected path ${pathname}. Redirecting to /login.`);
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set('callbackUrl', req.nextUrl.href);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/api/")) {
    try {
        // @ts-ignore
        const { success } = await rateLimit.limit(ip as string);
        if (!success) {
            console.log(`[Middleware] Rate limit exceeded for IP: ${ip}, Path: ${pathname}`);
            return new NextResponse(JSON.stringify({ error: 'Too Many Requests' }), {
              status: 429,
              headers: { 'Content-Type': 'application/json' }
            });
        }
        console.log(`[Middleware] Rate limit check passed for IP: ${ip}, Path: ${pathname}`);
    } catch (error) {
        console.error("[Middleware] Rate limiting error:", error);
        return new NextResponse(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
    }
    return NextResponse.next();
  }

  console.log(`[Middleware] Path ${pathname} allowed by rules or default.`);
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api/auth/|_next/static|_next/image|public|.*\\.).*)',
    '/',
   ],
};