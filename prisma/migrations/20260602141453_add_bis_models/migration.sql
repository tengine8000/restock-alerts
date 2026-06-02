-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subscribedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" DATETIME
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriberId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "providerName" TEXT
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "autoSendEnabled" BOOLEAN NOT NULL DEFAULT true,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "emailFromName" TEXT NOT NULL DEFAULT 'Your Store',
    "emailSubject" TEXT NOT NULL DEFAULT 'Good news — your item is back in stock!',
    "emailBodyHtml" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Subscriber_shop_idx" ON "Subscriber"("shop");

-- CreateIndex
CREATE INDEX "Subscriber_shop_variantId_status_idx" ON "Subscriber"("shop", "variantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_shop_variantId_email_key" ON "Subscriber"("shop", "variantId", "email");

-- CreateIndex
CREATE INDEX "NotificationLog_shop_idx" ON "NotificationLog"("shop");

-- CreateIndex
CREATE INDEX "NotificationLog_shop_sentAt_idx" ON "NotificationLog"("shop", "sentAt");
