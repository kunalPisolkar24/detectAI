import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/prisma";
import { SubscriptionStatus } from "@prisma/client";

export async function POST() {
  try {
    const session: any = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = session.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        paddleSubscriptionStatus: true,
        apiCallCountDaily: true,
        lastApiCallReset: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const isPremium = user.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE;

    // Always increment total count
    const dataToUpdate: { apiCallCountTotal: { increment: number }, apiCallCountDaily?: { increment: number } } = {
        apiCallCountTotal: { increment: 1 }
    };

    // Determine if the daily count should be incremented
    let allowDailyIncrement = true;

    if (!isPremium) {
        // For free users, check the limit
        const dailyLimit = parseInt(process.env.DAILY_API_LIMIT_FREE || "100", 10);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let currentDailyCount = user.apiCallCountDaily;

        // Safety check for reset (important if profile wasn't fetched recently)
        if (!user.lastApiCallReset || user.lastApiCallReset < todayStart) {
            currentDailyCount = 0;
        }

        // Only prevent daily increment if free user is at or over the limit
        if (currentDailyCount >= dailyLimit) {
            allowDailyIncrement = false;
            console.log(`User ${userId} attempted API call but reached daily limit.`);
        }
    }

    // Add daily increment if allowed (true for premium, conditional for free)
    if (allowDailyIncrement) {
        dataToUpdate.apiCallCountDaily = { increment: 1 };
    }

    // Perform the update
    await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true }, { status: 200 });

  } catch (error) {
    console.error("Error incrementing API usage:", error);
    return NextResponse.json({ error: "Failed to update usage" }, { status: 500 });
  }
}