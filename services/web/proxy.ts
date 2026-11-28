import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { env } from "@/lib/config/env"

export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request, secret: env.auth.secret })
  if (token) return NextResponse.next()

  const url = new URL("/login", request.url)
  url.searchParams.set("callbackUrl", request.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/profile"],
}
