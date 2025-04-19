// api/webhooks/paddle/route.ts
import { NextRequest, NextResponse } from "next/server";
import { validateSignature } from "@/utils/paddle";
import prisma from "@/lib/prisma";
import { SubscriptionStatus } from "@prisma/client";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("Paddle-Signature");
  const body = await req.text();

  if (!signature) {
    console.warn("[Webhook Error] Missing Paddle signature header.");
    return NextResponse.json({ message: "Missing Paddle signature" }, { status: 400 });
  }

  if (!process.env.PADDLE_WEBHOOK_SECRET) {
    console.error("[Webhook Error] Paddle webhook secret is not configured.");
    return NextResponse.json({ error: "Webhook secret not configured." }, { status: 500 });
  }

  const isValid = await validateSignature(signature, body, process.env.PADDLE_WEBHOOK_SECRET!);

  if (!isValid) {
    console.warn("[Webhook Error] Invalid Paddle webhook signature.");
    return NextResponse.json({ message: "Invalid webhook signature!" }, { status: 401 });
  }

  console.log("[Webhook Signature] Signature VALID.");

  let event;
  try {
    event = JSON.parse(body);
    console.log("[Webhook Event Parsed] Event Type:", event?.event_type);
  } catch (error: any) {
    console.error("[Webhook Error] Failed to parse JSON body:", error);
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const eventType = event.event_type;
    const eventData = event.data;

    const userId = eventData?.custom_data?.userId;
    if (!userId) {
      console.error("[Webhook Error] Critical: Webhook received without userId in custom_data. Event:", eventType, "Data:", JSON.stringify(eventData));
      return NextResponse.json({ received: true, error: "Missing userId" }, { status: 200 });
    }

    let prismaStatus: SubscriptionStatus | null = null;
    const rawStatus = eventData?.status;
    if (rawStatus) {
      const statusUpper = rawStatus.toUpperCase();
      if (statusUpper === 'ACTIVE') prismaStatus = SubscriptionStatus.ACTIVE;
      else if (statusUpper === 'CANCELED') prismaStatus = SubscriptionStatus.CANCELED;
      else if (statusUpper === 'PAST_DUE') prismaStatus = SubscriptionStatus.PAST_DUE;
      else if (statusUpper === 'PAUSED') prismaStatus = SubscriptionStatus.PAUSED;
      else if (statusUpper === 'TRIALING') prismaStatus = SubscriptionStatus.TRIALING;
      else console.warn(`[Webhook Status] Unknown Paddle subscription status: ${rawStatus}`);
    }
    console.log(`[Webhook Status] User: ${userId}, Event: ${eventType}, Mapped Prisma Status: ${prismaStatus}`);

    const subscriptionId = eventData?.id;
    const customerId = eventData?.customer_id;
    const planId = eventData?.items?.[0]?.price?.id;
    const endsAtString = eventData?.current_billing_period?.ends_at || eventData?.scheduled_change?.effective_at || eventData?.canceled_at || null;
    const endsAt = endsAtString ? new Date(endsAtString) : null;
    const scheduledChangeAction = eventData?.scheduled_change?.action; // Check for scheduled change

    console.log(`[Webhook Data] User ID: ${userId}`);
    console.log(`[Webhook Data] Subscription ID: ${subscriptionId}`);
    console.log(`[Webhook Data] Customer ID: ${customerId}`);
    console.log(`[Webhook Data] Plan ID: ${planId}`);
    console.log(`[Webhook Data] Ends At: ${endsAt}`);
    console.log(`[Webhook Data] Scheduled Change Action: ${scheduledChangeAction}`);


    switch (eventType) {
      case "subscription.created":
      case "subscription.updated":
        if (!subscriptionId || !customerId || !prismaStatus || !planId) {
           console.error("[Webhook Error] Missing required data for update/create event:", eventType, "for user:", userId, "Sub:", subscriptionId, "Cust:", customerId, "Status:", prismaStatus, "Plan:", planId);
           return NextResponse.json({ received: true, error: "Missing subscription data for update" }, { status: 200 });
        }

        const dataToUpdate: any = {
            paddleCustomerId: customerId,
            paddleSubscriptionId: subscriptionId,
            paddlePlanId: planId,
            paddleSubscriptionStatus: prismaStatus,
            subscriptionEndsAt: endsAt,
        };

        // *** Critical Change Here ***
        // Only reset the scheduled flag if the update IS NOT just confirming a cancellation schedule
        if (scheduledChangeAction !== 'cancel') {
            console.log(`[Webhook DB Update] Resetting paddleCancellationScheduled=false because scheduledChangeAction is not 'cancel' (it is '${scheduledChangeAction}')`);
            dataToUpdate.paddleCancellationScheduled = false;
        } else {
             console.log(`[Webhook DB Update] Keeping paddleCancellationScheduled as is because scheduledChangeAction is 'cancel'.`);
             // Don't touch the flag if the update is due to scheduling cancellation
        }

        console.log(`[Webhook DB] Attempting to update user ${userId} with status ${prismaStatus}, subId ${subscriptionId}`);
        await prisma.user.update({
          where: { id: userId },
          data: dataToUpdate,
        });
        console.log(`[Webhook DB Success] User ${userId} updated.`);
        break;

      case "subscription.canceled":
         // This logic remains the same - it handles the FINAL cancellation
         if (!subscriptionId || !prismaStatus || prismaStatus !== SubscriptionStatus.CANCELED) {
           console.error("[Webhook Error] Missing required data or incorrect status for cancel event:", eventType," for user:", userId, "Status:", prismaStatus, "Sub:", subscriptionId);
           return NextResponse.json({ received: true, error: "Missing/Invalid subscription data for cancel" }, { status: 200 });
         }
         console.log(`[Webhook DB] Attempting to update user ${userId} for FINAL cancellation, subId ${subscriptionId}`);
         await prisma.user.updateMany({
            where: { id: userId, paddleSubscriptionId: subscriptionId },
            data: {
                paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
                subscriptionEndsAt: endsAt,
                paddleCancellationScheduled: false, // Reset flag on final cancellation
                // Clear Paddle details
                paddleSubscriptionId: null,
                paddlePlanId: null,
                // paddleCustomerId: null, // Optional: keep customer ID
            },
         });
        console.log(`[Webhook DB Success] User ${userId} FINAL cancellation processed, status CANCELED, flag reset, details cleared.`);
        break;

      case "transaction.completed":
          console.log(`[Webhook Info] Received transaction.completed for user ${userId}, Sub ID: ${eventData?.subscription_id}, Transaction ID: ${eventData?.id}. Subscription status likely handled by subscription.updated.`);
          break;

      default:
        console.log(`[Webhook Info] Unhandled event type: ${eventType} for user ${userId}`);
    }

    console.log(`[Webhook Success] Processed event: ${eventType} for user ${userId}`);
    return NextResponse.json({ message: "Webhook processed successfully." }, { status: 200 });

  } catch (error: any) {
    console.error(`[Webhook Processing Error] Error processing event ${event?.event_type} for user ${event?.data?.custom_data?.userId}:`, error);
    if (error.code) {
        console.error(`[Webhook Prisma Error] Code: ${error.code}, Meta: ${JSON.stringify(error.meta)}`);
    }
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}