// import { NextResponse } from "next/server";
// import type { NextRequest } from "next/server";
// import { getToken } from "next-auth/jwt";
// import rateLimit from "@/config/rateLimit";

// export async function middleware(req: NextRequest) {
//   const { pathname } = req.nextUrl;

//   if (pathname.startsWith("/public/")) {
//     return NextResponse.next();
//   }

//   if (pathname.startsWith("/chat")) {
//     const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
//     if (!token) {
//       const url = req.nextUrl.clone();
//       url.pathname = "/login";
//       return NextResponse.redirect(url);
//     }
//     return NextResponse.next();
//   }

//   if (pathname.startsWith("/profile")) {
//     const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
//     if (!token) {
//       const url = req.nextUrl.clone();
//       url.pathname = "/login";
//       return NextResponse.redirect(url);
//     }
//     return NextResponse.next();
//   }

//   if (pathname.startsWith("/api/")) {
//     // @ts-ignore
//     const identifier = req.ip ?? "127.0.0.1";
//     const isAllowed = await rateLimit.limit(identifier);

//     if (!isAllowed.success) {
//       return new NextResponse(null, {
//         status: 429,
//         statusText: "Too Many Requests",
//         headers: {
//           "Content-Type": "text/plain",
//         },
//       });
//     }
//   }

//   return NextResponse.next();
// }

// export const config = {
//   matcher: ['/api/:path*', '/chat/:path*', '/profile/:path*']
// };

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import rateLimit from "@/config/rateLimit";

const secret = process.env.NEXTAUTH_SECRET;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // @ts-ignore
  const ip = req.ip ?? "127.0.0.1";

  console.log(`[Middleware] Path: ${pathname}, IP: ${ip}`);

  if (pathname.startsWith("/public/")) {
    console.log(`[Middleware] Allowing public path: ${pathname}`);
    return NextResponse.next();
  }

  if (pathname.startsWith("/chat") || pathname.startsWith("/profile")) {
    console.log(`[Middleware] Checking protected route: ${pathname}`);

    if (!secret) {
       console.error("[Middleware] ERROR: NEXTAUTH_SECRET is not defined!");
       const url = req.nextUrl.clone();
       url.pathname = "/auth/error?error=ConfigurationError";
       return NextResponse.redirect(url);
    }

    const cookieHeader = req.headers.get('cookie');
    console.log(`[Middleware] Cookie header present: ${!!cookieHeader}`);

    const token = await getToken({ req, secret });

    if (!token) {
      console.log(`[Middleware] getToken returned null for ${pathname}. Redirecting to /login.`);
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(url);
    } else {
      console.log(`[Middleware] getToken success for ${pathname}. User ID: ${token.sub || token.id}. Allowing access.`);
      return NextResponse.next();
    }
  }

  if (pathname.startsWith("/api/")) {
    try {
        // @ts-ignore
        const { success } = await rateLimit.limit(ip as string);
        if (!success) {
            console.log(`[Middleware] Rate limit exceeded for IP: ${ip}, Path: ${pathname}`);
            return new NextResponse(null, { status: 429, statusText: "Too Many Requests" });
        }
        console.log(`[Middleware] Rate limit check passed for IP: ${ip}, Path: ${pathname}`);
    } catch (error) {
        console.error("[Middleware] Rate limiting error:", error);
    }
  }

  console.log(`[Middleware] No specific rule matched for ${pathname}, allowing.`);
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/chat/:path*', '/profile/:path*']
};