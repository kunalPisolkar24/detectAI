import { NextResponse, NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { Paddle } from '@paddle/paddle-node-sdk';
import prisma from "@/lib/prisma";
import { SubscriptionStatus } from "@prisma/client";

const paddleApiKey = process.env.PADDLE_API_KEY;

if (!paddleApiKey) {
  console.error("CRITICAL: PADDLE_API_KEY environment variable is not set.");
}

const paddle = new Paddle(paddleApiKey || '');

export async function POST(req: NextRequest) {
  if (!paddleApiKey) {
      return NextResponse.json({ error: "Paddle API key not configured on server." }, { status: 500 });
  }

  try {
    const session: any = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized: No active session found." }, { status: 401 });
    }

    const userId = session.user.id;
    const { paddleSubscriptionId } = await req.json();

    if (!paddleSubscriptionId || typeof paddleSubscriptionId !== 'string') {
      return NextResponse.json({ error: "Missing or invalid paddleSubscriptionId in request body." }, { status: 400 });
    }

    // Optional: Verify the subscription ID belongs to the logged-in user in your DB
    const userSubscription = await prisma.user.findFirst({
        where: {
            id: userId,
            paddleSubscriptionId: paddleSubscriptionId,
        },
        select: { paddleSubscriptionId: true } // Just need to confirm it exists for this user
    });

    if (!userSubscription) {
        console.warn(`[API Cancel Sub Warn] User ${userId} attempted to cancel non-matching/non-existent subscription ID: ${paddleSubscriptionId}`);
        // Return a generic error or a more specific one depending on security policy
        return NextResponse.json({ error: "Subscription not found or doesn't belong to user." }, { status: 404 });
    }

    console.log(`[API Cancel Sub] User ${userId} initiating cancellation for subscription ID: ${paddleSubscriptionId}`);

    const canceledSubscription = await paddle.subscriptions.cancel(paddleSubscriptionId, {});

    console.log(`[API Cancel Sub Success] Paddle API response for ${paddleSubscriptionId}: Status=${canceledSubscription.status}, EffectiveAt=${canceledSubscription.scheduledChange?.effectiveAt}`);

    const endsAt = canceledSubscription.scheduledChange?.effectiveAt || canceledSubscription.currentBillingPeriod?.endsAt || null;

    // Update local database to reflect the cancellation status immediately
    await prisma.user.update({
        where: {
            id: userId,
            paddleSubscriptionId: paddleSubscriptionId, // Ensure idempotency and correct user
        },
        data: {
            paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
            subscriptionEndsAt: endsAt ? new Date(endsAt) : null,
        },
    });
    console.log(`[API Cancel Sub DB Update] Local DB updated for user ${userId}, sub ${paddleSubscriptionId}. Status: CANCELED, EndsAt: ${endsAt}`);

    return NextResponse.json(
        {
            message: "Subscription cancellation processed successfully.",
            status: canceledSubscription.status, // e.g., "canceled"
            endsAt: endsAt,
        },
        { status: 200 }
    );

  } catch (error: any) {
    console.error("[API Cancel Sub Error] Failed during subscription cancellation process:", error);

    let errorMessage = "Failed to process subscription cancellation.";
    let statusCode = 500;

    // Handle specific Paddle errors using paddle-node-sdk structure (check its docs for exact error types/codes)
    // Example: (Error structure might vary based on SDK version)
    if (error?.name === 'PaddleError') { // Check if it's a Paddle SDK error
       console.error(`[API Cancel Sub Error] Paddle Error Details: ${error.message}`);
       // You might check error.type or specific codes if available in the error object
       if (error.message.includes('not found')) { // Simple string check example
           errorMessage = "Subscription not found via Paddle API.";
           statusCode = 404;
       } else {
           errorMessage = `Paddle API Error: ${error.message}`;
           statusCode = 400; // Or 502 Bad Gateway if it's an upstream issue
       }
    } else if (error instanceof SyntaxError) { // JSON parsing error
        errorMessage = "Invalid request body format.";
        statusCode = 400;
    }

    return NextResponse.json(
        { error: errorMessage, details: error.message || 'No additional details' },
        { status: statusCode }
    );
  }
}

