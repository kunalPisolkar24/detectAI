import { NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { SubscriptionStatus } from "@prisma/client"; // Import the enum

const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET;

// Helper function to verify Paddle signature (requires 'crypto' module)
// Adapated from Paddle documentation examples
function verifyPaddleSignature(rawBody: Buffer, signatureHeader: string): boolean {
  if (!PADDLE_WEBHOOK_SECRET || !signatureHeader) {
    console.error("Missing Paddle webhook secret or signature header.");
    return false;
  }

  const parts = signatureHeader.split(';');
  const timestampPart = parts.find(part => part.startsWith('ts='));
  const signaturePart = parts.find(part => part.startsWith('h1='));

  if (!timestampPart || !signaturePart) {
    console.error("Invalid signature header format.");
    return false;
  }

  const timestamp = timestampPart.split('=')[1];
  const signature = signaturePart.split('=')[1];

  if (!timestamp || !signature) {
    console.error("Missing timestamp or signature value.");
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody.toString()}`;
  const hmac = crypto.createHmac('sha256', PADDLE_WEBHOOK_SECRET);
  const computedSignature = hmac.update(signedPayload).digest('hex');

  // Use timing-safe comparison for security
  try {
      const safeComparison = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(computedSignature, 'hex'));
      if (!safeComparison) {
          console.warn("Paddle signature mismatch.");
      }
      return safeComparison;
  } catch (error) {
      console.error("Error during timingSafeEqual:", error);
      return false; // Error during comparison means invalid
  }
}


export async function POST(request: Request) {
  if (!PADDLE_WEBHOOK_SECRET) {
     console.error("Paddle webhook secret is not configured.");
     return NextResponse.json({ error: "Webhook secret not configured." }, { status: 500 });
  }

  const rawBody = await request.arrayBuffer(); // Read raw body as ArrayBuffer for verification
  const bodyBuffer = Buffer.from(rawBody); // Convert to Buffer
  // @ts-ignore
  const signature = headers().get("Paddle-Signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Paddle signature" }, { status: 400 });
  }

  // --- Verify Signature ---
  const isValidSignature = verifyPaddleSignature(bodyBuffer, signature);
  if (!isValidSignature) {
     console.warn("Invalid Paddle webhook signature received.");
     return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // --- Process Validated Webhook ---
  try {
    const event = JSON.parse(bodyBuffer.toString()); // Parse body *after* verification

    console.log("Received Paddle event:", event.event_type);

    const userId = event.data?.custom_data?.userId; // Get userId from custom data
    const subscriptionId = event.data?.id;
    const customerId = event.data?.customer_id;
    let status = event.data?.status?.toUpperCase(); // Convert status to uppercase for enum matching
    const planId = event.data?.items?.[0]?.price?.id; // Get plan ID
    const endsAtString = event.data?.current_billing_period?.ends_at || event.data?.scheduled_change?.effective_at || null;
    const endsAt = endsAtString ? new Date(endsAtString) : null;

    // Map Paddle status to Prisma Enum (adjust if Paddle uses different terms)
    let prismaStatus: SubscriptionStatus | null = null;
    if (status) {
      switch (status) {
        case 'ACTIVE': prismaStatus = SubscriptionStatus.ACTIVE; break;
        case 'CANCELED': prismaStatus = SubscriptionStatus.CANCELED; break;
        case 'PAST_DUE': prismaStatus = SubscriptionStatus.PAST_DUE; break;
        case 'PAUSED': prismaStatus = SubscriptionStatus.PAUSED; break;
        case 'TRIALING': prismaStatus = SubscriptionStatus.TRIALING; break;
        default:
          console.warn(`Unknown Paddle subscription status: ${status}`);
          // Decide how to handle unknown statuses - maybe set to null or a specific state
      }
    }


    if (!userId) {
      console.error("Webhook received without userId in custom_data for event:", event.event_type, "Sub ID:", subscriptionId);
      // Return 200 to Paddle even if we can't process, to prevent retries for this specific issue
      return NextResponse.json({ received: true, error: "Missing userId" }, { status: 200 });
    }

    switch (event.event_type) {
      case "subscription.created":
      case "subscription.updated":
        if (!subscriptionId || !customerId || !prismaStatus) {
           console.error("Missing required data in subscription created/updated event for user:", userId);
           return NextResponse.json({ received: true, error: "Missing subscription data" }, { status: 200 });
        }
        await prisma.user.update({
          where: { id: userId },
          data: {
            paddleCustomerId: customerId,
            paddleSubscriptionId: subscriptionId,
            paddlePlanId: planId,
            paddleSubscriptionStatus: prismaStatus,
            subscriptionEndsAt: endsAt,
            // Reset daily count on new active subscription potentially? Or handle elsewhere.
          },
        });
        console.log(`Subscription ${event.event_type} processed for user ${userId}, status ${prismaStatus}`);
        break;

      case "subscription.canceled":
         if (!subscriptionId || !prismaStatus) {
           console.error("Missing required data in subscription canceled event for user:", userId);
           return NextResponse.json({ received: true, error: "Missing subscription data" }, { status: 200 });
         }
        // When canceled, keep the subscription ID but update status and potentially endsAt
        await prisma.user.update({
          where: { id: userId, paddleSubscriptionId: subscriptionId }, // Ensure we only update the correct user/sub
          data: {
            paddleSubscriptionStatus: prismaStatus, // Should be CANCELED
            // Paddle often provides when access ends in `endsAt` upon cancellation
            subscriptionEndsAt: endsAt,
          },
        });
        console.log(`Subscription canceled processed for user ${userId}`);
        break;

      // Add cases for other events if needed (e.g., payment failed, subscription paused)

      default:
        console.log(`Unhandled Paddle event type: ${event.event_type}`);
    }

    // Respond to Paddle quickly
    return NextResponse.json({ received: true }, { status: 200 });

  } catch (error: any) {
    console.error("Error processing Paddle webhook:", error);
    // Don't send detailed error back to Paddle
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}