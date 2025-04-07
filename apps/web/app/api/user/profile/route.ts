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
  // Add other relevant fields fetched from the Account model if needed
}

export interface UserProfileData {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  memberSince: Date;
  isPremium: boolean;
  premiumPlanId: string | null;
  premiumExpiry: Date | null; // Renamed for clarity, maps to subscriptionEndsAt
  subscriptionStatus: SubscriptionStatus | null; // Use the enum type
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

    let user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: {
          select: { // Select only necessary fields from Account
            id: true,
            userId: true,
            provider: true,
            providerAccountId: true,
            type: true, // Might be useful to know it's 'oauth'
          }
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // --- Daily API Call Reset Logic ---
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today UTC

    let needsUpdate = false;
    let currentDailyCount = user.apiCallCountDaily;

    if (!user.lastApiCallReset || user.lastApiCallReset < todayStart) {
       // Reset needed
       currentDailyCount = 0; // Reset count for the response
       needsUpdate = true;
       console.log(`Resetting daily API count for user ${userId}`);
    }

    // If reset was needed, update the database *after* fetching
    // This avoids blocking the response for the update
    if (needsUpdate) {
       prisma.user.update({
           where: { id: userId },
           data: {
               apiCallCountDaily: 0,
               lastApiCallReset: now, // Set reset time to now
           },
       }).catch(err => {
           // Log error if update fails, but don't fail the profile request
           console.error(`Failed to update daily API reset for user ${userId}:`, err);
       });
    }
    // --- End Daily API Call Reset Logic ---


    const isPremium = user.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE;
    const dailyApiLimit = isPremium ? null : 100;

    const profileData: UserProfileData = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      memberSince: user.createdAt,
      isPremium: isPremium,
      premiumPlanId: user.paddlePlanId,
      premiumExpiry: user.subscriptionEndsAt, // Use the field directly
      subscriptionStatus: user.paddleSubscriptionStatus,
      connectedAccounts: user.accounts.map(acc => ({ // Map included accounts
        provider: acc.provider,
        id: acc.id,
        userId: acc.userId,
        providerAccountId: acc.providerAccountId,
      })),
      usage: {
        apiCalls: {
          // Use the potentially reset count for the *current* response
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

// --- Optional: PUT endpoint to update basic profile info ---
export async function PUT(request: Request) {
   try {
    const session: any = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await request.json();

    // Add Zod validation for firstName and lastName updates
    const updateSchema = z.object({
       firstName: z.string().min(1).optional(),
       lastName: z.string().min(1).optional(),
    }).strict(); // Use strict to prevent extra fields

    const validation = updateSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json({ error: "Invalid input", details: validation.error.flatten().fieldErrors }, { status: 400 });
    }

    const dataToUpdate: { firstName?: string; lastName?: string; name?: string } = {};
    if (validation.data.firstName) dataToUpdate.firstName = validation.data.firstName;
    if (validation.data.lastName) dataToUpdate.lastName = validation.data.lastName;

    // Update the combined 'name' field if first/last name is updated
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
      select: { // Return updated fields
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