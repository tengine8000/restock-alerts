-- CreateTable
CREATE TABLE "InventoryLevel" (
    "shop" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "available" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLevel_pkey" PRIMARY KEY ("shop","inventoryItemId")
);

-- CreateIndex
CREATE INDEX "InventoryLevel_shop_idx" ON "InventoryLevel"("shop");
