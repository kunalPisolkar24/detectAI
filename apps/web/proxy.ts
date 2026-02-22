import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const start = performance.now()
  const token = await getToken({ req: request })
  const isAuth = !!token
  const { pathname } = request.nextUrl

  let response = NextResponse.next()

  if (pathname.startsWith("/api/auth") || pathname.startsWith("/_next") || pathname.includes("favicon.ico") || pathname.startsWith("/api/metrics")) {
    return response
  }

  if (isAuth) {
    if (pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/signup")) {
      response = NextResponse.redirect(new URL("/chat", request.url))
    }
  }

  if (!isAuth) {
    if (pathname.startsWith("/chat") || pathname.startsWith("/profile")) {
      const url = new URL("/login", request.url)
      url.searchParams.set("callbackUrl", pathname)
      response = NextResponse.redirect(url)
    }
  }

  const duration = performance.now() - start
  console.log(JSON.stringify({
    level: "info",
    ts: Date.now(),
    msg: "Incoming Request",
    method: request.method,
    url: pathname,
    status: response.status,
    durationMs: duration.toFixed(2),
    userId: token?.id || "anonymous"
  }))

  return response
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
}