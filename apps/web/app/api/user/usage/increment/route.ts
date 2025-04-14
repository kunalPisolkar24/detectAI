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

    const dataToUpdate: { apiCallCountTotal: { increment: number }, apiCallCountDaily?: { increment: number }, lastApiCallReset?: Date } = {
        apiCallCountTotal: { increment: 1 }
    };

    if (!isPremium) {
        const dailyLimit = parseInt(process.env.DAILY_API_LIMIT_FREE || "100", 10);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let currentDailyCount = user.apiCallCountDaily;

        if (!user.lastApiCallReset || user.lastApiCallReset < todayStart) {
            currentDailyCount = 0;
        }

        if (currentDailyCount < dailyLimit) {
            dataToUpdate.apiCallCountDaily = { increment: 1 };
        } else {
            console.log(`User ${userId} attempted API call exceeding daily limit.`);
        }
    }

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