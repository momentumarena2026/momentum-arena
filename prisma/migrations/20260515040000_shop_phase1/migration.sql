-- Phase 1: Shop module schema
--
-- Adds a standalone "shop" surface for selling items (leather balls,
-- L-guards, etc) the venue keeps in inventory. Fulfilment is pickup
-- at venue only — no shipping. Separate from the Equipment-rental
-- tables so the two flows don't tangle.
--
-- New entities:
--   * ProductCategory          — optional groupings for the catalog
--   * Product                  — sellable item with stock + image
--   * Cart / CartItem          — per-user persisted basket
--   * ProductOrder             — checkout artifact (status, totals)
--   * ProductOrderItem         — line items (price + name snapshot)
--   * ProductOrderPayment      — 1:1 payment row (Razorpay/UPI/Cash)
--   * ProductStockMovement     — audit trail for every stock change
--
-- All idempotent — re-running mid-deploy is safe.

-- ── 1. Enums ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductOrderStatus') THEN
    CREATE TYPE "ProductOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FULFILLED', 'CANCELLED', 'REFUNDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductStockMovementReason') THEN
    CREATE TYPE "ProductStockMovementReason" AS ENUM ('SALE', 'RESTOCK', 'ADJUSTMENT', 'REFUND', 'RELEASE');
  END IF;
END$$;

-- ── 2. ProductCategory ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ProductCategory" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "displayOrder"  INTEGER NOT NULL DEFAULT 0,
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- ── 3. Product ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Product" (
  "id"                TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "pricePaise"        INTEGER NOT NULL,
  "stockQuantity"     INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 3,
  "imageUrl"          TEXT,
  "isActive"          BOOLEAN NOT NULL DEFAULT TRUE,
  "displayOrder"      INTEGER NOT NULL DEFAULT 0,
  "categoryId"        TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId")
    REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Product_isActive_displayOrder_idx" ON "Product"("isActive", "displayOrder");
CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");

-- ── 4. Cart / CartItem ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Cart" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Cart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Cart_userId_key" UNIQUE ("userId"),
  CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CartItem" (
  "id"        TEXT NOT NULL,
  "cartId"    TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity"  INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CartItem_cartId_productId_key" UNIQUE ("cartId", "productId"),
  CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId")
    REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CartItem_productId_idx" ON "CartItem"("productId");

-- ── 5. ProductOrder + ProductOrderItem + ProductOrderPayment ─────
CREATE TABLE IF NOT EXISTS "ProductOrder" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "status"           "ProductOrderStatus" NOT NULL DEFAULT 'PENDING',
  "totalPaise"       INTEGER NOT NULL,
  "fulfilledById"    TEXT,
  "fulfilledAt"      TIMESTAMP(3),
  "createdByAdminId" TEXT,
  "orderNumber"      TEXT,
  "cancelledAt"      TIMESTAMP(3),
  "cancelReason"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductOrder_orderNumber_key" UNIQUE ("orderNumber"),
  CONSTRAINT "ProductOrder_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProductOrder_userId_createdAt_idx" ON "ProductOrder"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductOrder_status_createdAt_idx" ON "ProductOrder"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "ProductOrderItem" (
  "id"             TEXT NOT NULL,
  "orderId"        TEXT NOT NULL,
  "productId"      TEXT NOT NULL,
  "nameSnapshot"   TEXT NOT NULL,
  "priceEachPaise" INTEGER NOT NULL,
  "quantity"       INTEGER NOT NULL,
  CONSTRAINT "ProductOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductOrderItem_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "ProductOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductOrderItem_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProductOrderItem_orderId_idx" ON "ProductOrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "ProductOrderItem_productId_idx" ON "ProductOrderItem"("productId");

CREATE TABLE IF NOT EXISTS "ProductOrderPayment" (
  "id"                   TEXT NOT NULL,
  "orderId"              TEXT NOT NULL,
  "method"               "PaymentMethod" NOT NULL,
  "status"               "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount"               INTEGER NOT NULL,
  "razorpayOrderId"      TEXT,
  "razorpayPaymentId"    TEXT,
  "razorpaySignature"    TEXT,
  "phonePeMerchantTxnId" TEXT,
  "phonePeTransactionId" TEXT,
  "utrNumber"            TEXT,
  "confirmedAt"          TIMESTAMP(3),
  "confirmedById"        TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductOrderPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductOrderPayment_orderId_key" UNIQUE ("orderId"),
  CONSTRAINT "ProductOrderPayment_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "ProductOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProductOrderPayment_razorpayPaymentId_idx" ON "ProductOrderPayment"("razorpayPaymentId");
CREATE INDEX IF NOT EXISTS "ProductOrderPayment_phonePeMerchantTxnId_idx" ON "ProductOrderPayment"("phonePeMerchantTxnId");

-- ── 6. ProductStockMovement (audit trail) ─────────────────────────
CREATE TABLE IF NOT EXISTS "ProductStockMovement" (
  "id"        TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "delta"     INTEGER NOT NULL,
  "reason"    "ProductStockMovementReason" NOT NULL,
  "orderId"   TEXT,
  "note"      TEXT,
  "adminId"   TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductStockMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductStockMovement_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProductStockMovement_productId_createdAt_idx" ON "ProductStockMovement"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductStockMovement_orderId_idx" ON "ProductStockMovement"("orderId");
