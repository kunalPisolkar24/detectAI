import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request })
  const isAuth = !!token
  const { pathname } = request.nextUrl

  if (pathname.startsWith("/api/auth") || pathname.startsWith("/_next") || pathname.includes("favicon.ico")) {
    return NextResponse.next()
  }

  if (isAuth) {
    if (pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/signup")) {
      return NextResponse.redirect(new URL("/chat", request.url))
    }
  }

  if (!isAuth) {
    if (pathname.startsWith("/chat")) {
      const url = new URL("/login", request.url)
      url.searchParams.set("callbackUrl", pathname)
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
}