import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/prisma";

const PADDLE_API_URL = process.env.PADDLE_ENVIRONMENT === 'production'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';

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
      return NextResponse.json({ error: "Subscription details not found for user." }, { status: 404 });
    }

    // Prevent multiple cancellation requests if already scheduled or not active
    if (user.paddleSubscriptionStatus !== 'ACTIVE' && user.paddleSubscriptionStatus !== 'TRIALING') {
        return NextResponse.json({ error: "Subscription is not active or already canceled." }, { status: 400 });
    }

    const subscriptionId = user.paddleSubscriptionId;

    console.log(`[API Cancel] Attempting to cancel subscription ${subscriptionId} for user ${userId} at period end.`);

    const paddleResponse = await fetch(`${PADDLE_API_URL}/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const responseData = await paddleResponse.json();

    if (!paddleResponse.ok) {
      console.error(`[API Cancel Error] Paddle API error for user ${userId}, subscription ${subscriptionId}: Status ${paddleResponse.status}`, responseData);
      const errorMessage = responseData?.error?.detail || "Failed to schedule subscription cancellation with payment provider.";
      return NextResponse.json({ error: errorMessage }, { status: paddleResponse.status });
    }

    console.log(`[API Cancel Success] Paddle scheduled cancellation for user ${userId}, subscription ${subscriptionId}. Response:`, responseData);

    // Update DB to mark cancellation as scheduled
    await prisma.user.update({
        where: { id: userId },
        data: {
            paddleCancellationScheduled: true,
            // Optionally update subscriptionEndsAt if Paddle API response guarantees it
            // subscriptionEndsAt: responseData.data.scheduled_change?.effective_at ? new Date(responseData.data.scheduled_change.effective_at) : undefined,
        }
    });

    console.log(`[API Cancel DB Update] Set paddleCancellationScheduled=true for user ${userId}`);

    return NextResponse.json({ success: true, message: "Subscription cancellation scheduled." }, { status: 200 });

  } catch (error: any) {
    console.error("[API Cancel Exception] Error cancelling subscription:", error);
    return NextResponse.json({ error: "Internal server error during cancellation request." }, { status: 500 });
  }
}