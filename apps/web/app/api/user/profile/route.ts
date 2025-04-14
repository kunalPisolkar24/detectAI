import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/prisma";
import { SubscriptionStatus } from "@prisma/client";
import { z } from "zod";

export interface UserProfileConnectedAccount {
  provider: string;
  id: string;
  userId: string;
  providerAccountId: string;
}

export interface UserProfileData {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  memberSince: Date;
  isPremium: boolean;
  premiumPlanId: string | null;
  premiumExpiry: Date | null;
  subscriptionStatus: SubscriptionStatus | null;
  paddleSubscriptionId: string | null;
  connectedAccounts: UserProfileConnectedAccount[];
  usage: {
    apiCalls: {
      current: number;
      limit: number | null;
      period: "Daily";
    };
    totalApiCallCount: number;
  };
}

export async function GET() {
  try {
    const session:any = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = session.user.id;

    // Fetch user fresh every time to ensure counts are up-to-date
    let user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: {
          select: {
            id: true,
            userId: true,
            provider: true,
            providerAccountId: true,
            type: true,
          }
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let currentDailyCount = user.apiCallCountDaily;

    // Check and perform reset if needed
    if (!user.lastApiCallReset || user.lastApiCallReset < todayStart) {
       currentDailyCount = 0; // Use 0 for the response
       console.log(`Resetting daily API count for user ${userId} during profile fetch.`);
       // Update the user record in the background
       prisma.user.update({
           where: { id: userId },
           data: {
               apiCallCountDaily: 0,
               lastApiCallReset: now,
           },
       }).catch(err => {
           // Log error but don't block the response
           console.error(`Failed to update daily API reset for user ${userId}:`, err);
       });
    }

    const isPremium = user.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE;
    // Use environment variable for the limit
    const dailyApiLimit = isPremium
        ? null
        : parseInt(process.env.DAILY_API_LIMIT_FREE || "100", 10);

    const profileData: UserProfileData = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      memberSince: user.createdAt,
      isPremium: isPremium,
      premiumPlanId: user.paddlePlanId,
      premiumExpiry: user.subscriptionEndsAt,
      subscriptionStatus: user.paddleSubscriptionStatus,
      paddleSubscriptionId: user.paddleSubscriptionId,
      connectedAccounts: user.accounts.map(acc => ({
        provider: acc.provider,
        id: acc.id,
        userId: acc.userId,
        providerAccountId: acc.providerAccountId,
      })),
      usage: {
        apiCalls: {
          current: currentDailyCount,
          limit: dailyApiLimit,
          period: "Daily",
        },
        totalApiCallCount: user.apiCallCountTotal,
      },
    };

    return NextResponse.json(profileData, { status: 200 });

  } catch (error) {
    console.error("Error fetching user profile:", error);
    return NextResponse.json({ error: "Failed to fetch profile data" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
   try {
    const session: any = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await request.json();

    const updateSchema = z.object({
       firstName: z.string().min(1).optional(),
       lastName: z.string().min(1).optional(),
    }).strict();

    const validation = updateSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json({ error: "Invalid input", details: validation.error.flatten().fieldErrors }, { status: 400 });
    }

    const dataToUpdate: { firstName?: string; lastName?: string; name?: string } = {};
    if (validation.data.firstName) dataToUpdate.firstName = validation.data.firstName;
    if (validation.data.lastName) dataToUpdate.lastName = validation.data.lastName;

    if (dataToUpdate.firstName || dataToUpdate.lastName) {
         const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true }});
         const newFirstName = dataToUpdate.firstName ?? currentUser?.firstName;
         const newLastName = dataToUpdate.lastName ?? currentUser?.lastName;
         if (newFirstName && newLastName) {
            dataToUpdate.name = `${newFirstName} ${newLastName}`;
         }
    }

    if (Object.keys(dataToUpdate).length === 0) {
         return NextResponse.json({ message: "No fields provided for update." }, { status: 400 });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
      select: {
         id: true,
         firstName: true,
         lastName: true,
         name: true,
         updatedAt: true,
      }
    });

    return NextResponse.json(updatedUser, { status: 200 });

  } catch (error) {
    console.error("Error updating user profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}