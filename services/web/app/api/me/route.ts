import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { getMe } from "@/lib/users/client"
import { readSessionTokens, withFreshAccessToken } from "@/lib/users/session"

export async function GET(request: NextRequest) {
  const tokens = await readSessionTokens(request)
  if (!tokens) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await withFreshAccessToken(tokens, (accessToken) => getMe(accessToken))
  if (!result.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: result.status })
  }

  const user = result.value
  const name =
    user.name?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email

  return NextResponse.json({
    user: { id: user.id, name, email: user.email, image: user.image ?? null },
  })
}
