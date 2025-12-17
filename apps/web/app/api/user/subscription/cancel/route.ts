import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/prisma";

const GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL || "http://localhost:8080";

export async function POST() {
  try {
    const session: any = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = session.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { paddleSubscriptionId: true, paddleSubscriptionStatus: true },
    });

    if (!user || !user.paddleSubscriptionId) {
      return NextResponse.json({ error: "Subscription details not found." }, { status: 404 });
    }

    if (user.paddleSubscriptionStatus !== 'ACTIVE' && user.paddleSubscriptionStatus !== 'TRIALING') {
      return NextResponse.json({ error: "Subscription is not active." }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { paddleCancellationScheduled: true }
    });

    const gatewayResponse = await fetch(`${GATEWAY_URL}/internal/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: "user.cancel_subscription",
        data: {
          userId: userId,
          paddleSubscriptionId: user.paddleSubscriptionId
        }
      }),
    });

    if (!gatewayResponse.ok) {
      await prisma.user.update({
        where: { id: userId },
        data: { paddleCancellationScheduled: false }
      });
      return NextResponse.json({ error: "Failed to schedule cancellation." }, { status: 503 });
    }

    return NextResponse.json({ success: true, message: "Cancellation scheduled." }, { status: 200 });

  } catch (error) {
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}