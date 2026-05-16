-- CreateSubscriptionAndUsageTables
-- Migrate embedded subscription/usage columns from User to separate tables

-- Create Subscription table
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paddleSubscriptionId" TEXT,
    "paddlePlanId" TEXT,
    "status" "SubscriptionStatus",
    "endsAt" TIMESTAMP(3),
    "cancellationScheduled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Subscription_userId_key" UNIQUE ("userId")
);

-- Create Usage table
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiCallCountDaily" INTEGER NOT NULL DEFAULT 0,
    "lastApiCallReset" TIMESTAMP(3),
    "apiCallCountTotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Usage_userId_key" UNIQUE ("userId")
);

-- Migrate data from User to Subscription
INSERT INTO "Subscription" ("id", "userId", "paddleSubscriptionId", "paddlePlanId", "status", "endsAt", "cancellationScheduled", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::TEXT,
    "id",
    "paddleSubscriptionId",
    "paddlePlanId",
    "paddleSubscriptionStatus",
    "subscriptionEndsAt",
    "paddleCancellationScheduled",
    "createdAt",
    "updatedAt"
FROM "User"
WHERE "paddleSubscriptionId" IS NOT NULL;

-- Migrate data from User to Usage
INSERT INTO "Usage" ("id", "userId", "apiCallCountDaily", "lastApiCallReset", "apiCallCountTotal", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::TEXT,
    "id",
    "apiCallCountDaily",
    "lastApiCallReset",
    "apiCallCountTotal",
    "createdAt",
    "updatedAt"
FROM "User"
WHERE "apiCallCountTotal" > 0 OR "apiCallCountDaily" > 0;

-- Add foreign key constraints
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Remove embedded columns from User
ALTER TABLE "User" DROP COLUMN IF EXISTS "paddleSubscriptionId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "paddlePlanId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "paddleSubscriptionStatus";
ALTER TABLE "User" DROP COLUMN IF EXISTS "subscriptionEndsAt";
ALTER TABLE "User" DROP COLUMN IF EXISTS "paddleCancellationScheduled";
ALTER TABLE "User" DROP COLUMN IF EXISTS "apiCallCountDaily";
ALTER TABLE "User" DROP COLUMN IF EXISTS "lastApiCallReset";
ALTER TABLE "User" DROP COLUMN IF EXISTS "apiCallCountTotal";

-- Drop unique indexes that were on embedded columns
DROP INDEX IF EXISTS "User_paddleSubscriptionId_key";
