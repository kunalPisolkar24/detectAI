/*
  Warnings:

  - A unique constraint covering the columns `[paddleCustomerId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[paddleSubscriptionId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELED', 'PAST_DUE', 'PAUSED', 'TRIALING');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "apiCallCountDaily" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "apiCallCountTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastApiCallReset" TIMESTAMP(3),
ADD COLUMN     "paddleCustomerId" TEXT,
ADD COLUMN     "paddlePlanId" TEXT,
ADD COLUMN     "paddleSubscriptionId" TEXT,
ADD COLUMN     "paddleSubscriptionStatus" "SubscriptionStatus",
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_paddleCustomerId_key" ON "User"("paddleCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_paddleSubscriptionId_key" ON "User"("paddleSubscriptionId");
