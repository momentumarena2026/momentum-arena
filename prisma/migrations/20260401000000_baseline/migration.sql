warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('CRICKET', 'FOOTBALL', 'PICKLEBALL', 'BADMINTON');

-- CreateEnum
CREATE TYPE "ConfigSize" AS ENUM ('XS', 'SMALL', 'MEDIUM', 'LARGE', 'XL', 'FULL', 'SHARED');

-- CreateEnum
CREATE TYPE "CourtZone" AS ENUM ('LEATHER_1', 'BOX_A', 'BOX_B', 'LEATHER_2', 'SHARED_COURT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('LOCKED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('RAZORPAY', 'PHONEPE', 'UPI_QR', 'CASH', 'FREE');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('PHONEPE', 'RAZORPAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('WEEKDAY', 'WEEKEND');

-- CreateEnum
CREATE TYPE "TimeType" AS ENUM ('PEAK', 'OFF_PEAK');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FLAT');

-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('BOOK_PAGE', 'SLOT_SELECTION', 'CHECKOUT');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "CouponScope" AS ENUM ('SPORTS', 'CAFE', 'BOTH');

-- CreateEnum
CREATE TYPE "CouponConditionType" AS ENUM ('MIN_AMOUNT', 'FIRST_PURCHASE', 'USER_GROUP', 'SPORT_SPECIFIC', 'CATEGORY_SPECIFIC', 'TIME_WINDOW', 'BIRTHDAY', 'REFERRAL');

-- CreateEnum
CREATE TYPE "UserGroupType" AS ENUM ('FIRST_TIME', 'PREMIUM_PLAYER', 'FREQUENT_VISITOR', 'BIRTHDAY_MONTH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RewardTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "PointsTransactionType" AS ENUM ('EARNED_BOOKING', 'EARNED_CAFE', 'EARNED_REFERRAL', 'EARNED_BONUS', 'REDEEMED_BOOKING', 'REDEEMED_CAFE', 'EXPIRED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CafeOrderStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CafeItemCategory" AS ENUM ('SNACKS', 'BEVERAGES', 'MEALS', 'DESSERTS', 'COMBOS');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'BOOKED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "PaymentGatewayConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "activeGateway" "PaymentGateway" NOT NULL DEFAULT 'PHONEPE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "emailVerified" TIMESTAMP(3),
    "phoneVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "passwordSetAt" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "referralCode" TEXT,
    "referredBy" TEXT,
    "birthday" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourtConfig" (
    "id" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "size" "ConfigSize" NOT NULL,
    "label" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "widthFt" INTEGER NOT NULL,
    "lengthFt" INTEGER NOT NULL DEFAULT 90,
    "zones" "CourtZone"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourtConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courtConfigId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'LOCKED',
    "lockedAt" TIMESTAMP(3),
    "lockExpiresAt" TIMESTAMP(3),
    "totalAmount" INTEGER NOT NULL,
    "originalAmount" INTEGER,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "discountCodeId" TEXT,
    "rewardPointsUsed" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsEarned" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "qrToken" TEXT,
    "reminder24SentAt" TIMESTAMP(3),
    "reminder2SentAt" TIMESTAMP(3),
    "recurringBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingSlot" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "startHour" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "BookingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "phonePeMerchantTxnId" TEXT,
    "phonePeTransactionId" TEXT,
    "utrNumber" TEXT,
    "utrSubmittedAt" TIMESTAMP(3),
    "utrVerifiedAt" TIMESTAMP(3),
    "utrExpiresAt" TIMESTAMP(3),
    "isPartialPayment" BOOLEAN NOT NULL DEFAULT false,
    "advanceAmount" INTEGER,
    "remainingAmount" INTEGER,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "refundedBy" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "courtConfigId" TEXT NOT NULL,
    "dayType" "DayType" NOT NULL,
    "timeType" "TimeType" NOT NULL,
    "pricePerSlot" INTEGER NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClassification" (
    "id" TEXT NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "dayType" "DayType" NOT NULL,
    "timeType" "TimeType" NOT NULL,

    CONSTRAINT "TimeClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotBlock" (
    "id" TEXT NOT NULL,
    "courtConfigId" TEXT,
    "sport" "Sport",
    "date" DATE NOT NULL,
    "startHour" INTEGER,
    "reason" TEXT,
    "blockedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discountInfo" TEXT,
    "imageUrl" TEXT,
    "placement" "BannerPlacement"[],
    "razorpayOfferId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1,
    "minBookingAmount" INTEGER,
    "sportFilter" "Sport"[],
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isSystemCode" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountUsage" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FAQEntry" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "keywords" TEXT[],
    "category" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FAQEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "permissions" TEXT[],
    "isDeletable" BOOLEAN NOT NULL DEFAULT true,
    "inviteToken" TEXT,
    "inviteTokenExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEditHistory" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminUsername" TEXT NOT NULL,
    "editType" TEXT NOT NULL,
    "previousDate" DATE,
    "newDate" DATE,
    "previousSlots" INTEGER[],
    "newSlots" INTEGER[],
    "previousCourtConfigId" TEXT,
    "newCourtConfigId" TEXT,
    "previousAmount" INTEGER,
    "newAmount" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "CafeItemCategory" NOT NULL,
    "price" INTEGER NOT NULL,
    "image" TEXT,
    "isVeg" BOOLEAN NOT NULL DEFAULT true,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "orderNumber" TEXT NOT NULL,
    "status" "CafeOrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" INTEGER NOT NULL,
    "originalAmount" INTEGER,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "discountCodeId" TEXT,
    "note" TEXT,
    "tableNumber" INTEGER,
    "rewardPointsUsed" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsEarned" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cafeItemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "totalPrice" INTEGER NOT NULL,

    CONSTRAINT "CafeOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafePayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "phonePeMerchantTxnId" TEXT,
    "phonePeTransactionId" TEXT,
    "utrNumber" TEXT,
    "utrSubmittedAt" TIMESTAMP(3),
    "utrVerifiedAt" TIMESTAMP(3),
    "utrExpiresAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "refundedBy" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeDiscount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1,
    "minOrderAmount" INTEGER,
    "categoryFilter" "CafeItemCategory"[],
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafeDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeDiscountUsage" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeDiscountUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeOrderEditHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminUsername" TEXT NOT NULL,
    "editType" TEXT NOT NULL,
    "previousItems" JSONB,
    "newItems" JSONB,
    "previousAmount" INTEGER,
    "newAmount" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeOrderEditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "scope" "CouponScope" NOT NULL DEFAULT 'BOTH',
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "maxDiscount" INTEGER,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1,
    "minAmount" INTEGER,
    "sportFilter" "Sport"[],
    "categoryFilter" "CafeItemCategory"[],
    "userGroupFilter" "UserGroupType"[],
    "isStackable" BOOLEAN NOT NULL DEFAULT false,
    "stackGroup" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isSystemCode" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponCondition" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "conditionType" "CouponConditionType" NOT NULL,
    "conditionValue" TEXT NOT NULL,

    CONSTRAINT "CouponCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponUsage" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT,
    "cafeOrderId" TEXT,
    "discountAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardPointsBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalRedeemed" INTEGER NOT NULL DEFAULT 0,
    "currentBalance" INTEGER NOT NULL DEFAULT 0,
    "tier" "RewardTier" NOT NULL DEFAULT 'BRONZE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardPointsBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PointsTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "bookingId" TEXT,
    "cafeOrderId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardConfig" (
    "id" TEXT NOT NULL,
    "sportsEarnRate" INTEGER NOT NULL DEFAULT 1,
    "cafeEarnRate" INTEGER NOT NULL DEFAULT 2,
    "referralBonus" INTEGER NOT NULL DEFAULT 100,
    "pointsPerRupee" INTEGER NOT NULL DEFAULT 10,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 100,
    "maxRedeemPercent" INTEGER NOT NULL DEFAULT 5000,
    "silverThreshold" INTEGER NOT NULL DEFAULT 500,
    "goldThreshold" INTEGER NOT NULL DEFAULT 2000,
    "platinumThreshold" INTEGER NOT NULL DEFAULT 5000,
    "bronzeMultiplier" INTEGER NOT NULL DEFAULT 10000,
    "silverMultiplier" INTEGER NOT NULL DEFAULT 12500,
    "goldMultiplier" INTEGER NOT NULL DEFAULT 15000,
    "platinumMultiplier" INTEGER NOT NULL DEFAULT 20000,
    "pointsExpiryDays" INTEGER NOT NULL DEFAULT 365,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeSettings" (
    "id" TEXT NOT NULL,
    "totalTables" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waitlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestPhone" TEXT,
    "guestEmail" TEXT,
    "courtConfigId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "notifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" "Sport",
    "pricePerHour" INTEGER NOT NULL,
    "totalUnits" INTEGER NOT NULL DEFAULT 1,
    "availableUnits" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentRental" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "totalPrice" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentRental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringConfig" (
    "id" TEXT NOT NULL,
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "allowedDays" JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    "maxWeeks" INTEGER NOT NULL DEFAULT 12,
    "minWeeks" INTEGER NOT NULL DEFAULT 2,
    "dailyTiers" JSONB NOT NULL DEFAULT '[]',
    "maxDays" INTEGER NOT NULL DEFAULT 30,
    "minDays" INTEGER NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringBooking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courtConfigId" TEXT NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "mode" TEXT NOT NULL DEFAULT 'weekly',
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Generator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratorConfig" (
    "id" TEXT NOT NULL,
    "petrolPricePerLitre" INTEGER NOT NULL DEFAULT 9500,
    "oilPricePerLitre" INTEGER NOT NULL DEFAULT 29500,
    "consumptionRate" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "firstOilChangeHours" INTEGER NOT NULL DEFAULT 20,
    "secondOilChangeHours" INTEGER NOT NULL DEFAULT 50,
    "regularOilChangeHours" INTEGER NOT NULL DEFAULT 100,
    "oilChangeAlertHours" INTEGER NOT NULL DEFAULT 10,
    "notificationEmails" TEXT NOT NULL DEFAULT 'y12.nakul@gmail.com,tangrianand@gmail.com,saxenautkarsh193@gmail.com,momentumarena2026@gmail.com',
    "oilChangeTemplateId" TEXT NOT NULL DEFAULT 'Oil_Change_Reminder',
    "monthlyTemplateId" TEXT NOT NULL DEFAULT 'Generator_Monthly_Summary',
    "pinChangeTemplateId" TEXT NOT NULL DEFAULT 'generator_pin_change',
    "generatorPin" TEXT NOT NULL DEFAULT '987065',
    "hardwareApiKey" TEXT NOT NULL DEFAULT 'ma-gen-hw-2026-secret',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratorFuelLog" (
    "id" TEXT NOT NULL,
    "generatorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "litres" DOUBLE PRECISION NOT NULL,
    "pricePerLitre" INTEGER NOT NULL,
    "totalCost" INTEGER NOT NULL,
    "isStockPurchase" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratorFuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratorOilChange" (
    "id" TEXT NOT NULL,
    "generatorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "runningHoursAtChange" DOUBLE PRECISION NOT NULL,
    "litres" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "costPerLitre" INTEGER NOT NULL,
    "totalCost" INTEGER NOT NULL,
    "notes" TEXT,
    "sequenceNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratorOilChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratorRunLog" (
    "id" TEXT NOT NULL,
    "generatorId" TEXT NOT NULL,
    "entryId" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'website',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "durationHours" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratorRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_identifier_action_key" ON "RateLimit"("identifier", "action");

-- CreateIndex
CREATE UNIQUE INDEX "CourtConfig_sport_size_position_key" ON "CourtConfig"("sport", "size", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_qrToken_key" ON "Booking"("qrToken");

-- CreateIndex
CREATE INDEX "Booking_courtConfigId_date_status_idx" ON "Booking"("courtConfigId", "date", "status");

-- CreateIndex
CREATE INDEX "Booking_userId_idx" ON "Booking"("userId");

-- CreateIndex
CREATE INDEX "Booking_lockExpiresAt_idx" ON "Booking"("lockExpiresAt");

-- CreateIndex
CREATE INDEX "Booking_date_status_idx" ON "Booking"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSlot_bookingId_startHour_key" ON "BookingSlot"("bookingId", "startHour");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "Payment_status_method_idx" ON "Payment"("status", "method");

-- CreateIndex
CREATE INDEX "Payment_utrExpiresAt_idx" ON "Payment"("utrExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_courtConfigId_dayType_timeType_key" ON "PricingRule"("courtConfigId", "dayType", "timeType");

-- CreateIndex
CREATE UNIQUE INDEX "TimeClassification_startHour_dayType_key" ON "TimeClassification"("startHour", "dayType");

-- CreateIndex
CREATE INDEX "SlotBlock_date_courtConfigId_idx" ON "SlotBlock"("date", "courtConfigId");

-- CreateIndex
CREATE INDEX "SlotBlock_date_sport_idx" ON "SlotBlock"("date", "sport");

-- CreateIndex
CREATE INDEX "Notification_bookingId_idx" ON "Notification"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountUsage_bookingId_key" ON "DiscountUsage"("bookingId");

-- CreateIndex
CREATE INDEX "DiscountUsage_userId_idx" ON "DiscountUsage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountUsage_discountCodeId_userId_bookingId_key" ON "DiscountUsage"("discountCodeId", "userId", "bookingId");

-- CreateIndex
CREATE INDEX "FAQEntry_category_idx" ON "FAQEntry"("category");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_inviteToken_key" ON "AdminUser"("inviteToken");

-- CreateIndex
CREATE INDEX "BookingEditHistory_bookingId_idx" ON "BookingEditHistory"("bookingId");

-- CreateIndex
CREATE INDEX "CafeItem_category_isAvailable_idx" ON "CafeItem"("category", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "CafeOrder_orderNumber_key" ON "CafeOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "CafeOrder_userId_idx" ON "CafeOrder"("userId");

-- CreateIndex
CREATE INDEX "CafeOrder_status_idx" ON "CafeOrder"("status");

-- CreateIndex
CREATE INDEX "CafeOrder_createdAt_idx" ON "CafeOrder"("createdAt");

-- CreateIndex
CREATE INDEX "CafeOrder_orderNumber_idx" ON "CafeOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "CafeOrderItem_orderId_idx" ON "CafeOrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CafePayment_orderId_key" ON "CafePayment"("orderId");

-- CreateIndex
CREATE INDEX "CafePayment_status_method_idx" ON "CafePayment"("status", "method");

-- CreateIndex
CREATE INDEX "CafePayment_utrExpiresAt_idx" ON "CafePayment"("utrExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CafeDiscount_code_key" ON "CafeDiscount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CafeDiscountUsage_orderId_key" ON "CafeDiscountUsage"("orderId");

-- CreateIndex
CREATE INDEX "CafeDiscountUsage_userId_idx" ON "CafeDiscountUsage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CafeDiscountUsage_discountId_userId_orderId_key" ON "CafeDiscountUsage"("discountId", "userId", "orderId");

-- CreateIndex
CREATE INDEX "CafeOrderEditHistory_orderId_idx" ON "CafeOrderEditHistory"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_scope_isActive_idx" ON "Coupon"("scope", "isActive");

-- CreateIndex
CREATE INDEX "Coupon_code_idx" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "CouponCondition_couponId_idx" ON "CouponCondition"("couponId");

-- CreateIndex
CREATE INDEX "CouponUsage_userId_idx" ON "CouponUsage"("userId");

-- CreateIndex
CREATE INDEX "CouponUsage_couponId_idx" ON "CouponUsage"("couponId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponUsage_couponId_userId_bookingId_key" ON "CouponUsage"("couponId", "userId", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardPointsBalance_userId_key" ON "RewardPointsBalance"("userId");

-- CreateIndex
CREATE INDEX "PointsTransaction_userId_idx" ON "PointsTransaction"("userId");

-- CreateIndex
CREATE INDEX "PointsTransaction_balanceId_idx" ON "PointsTransaction"("balanceId");

-- CreateIndex
CREATE INDEX "PointsTransaction_expiresAt_idx" ON "PointsTransaction"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_bookingId_key" ON "Feedback"("bookingId");

-- CreateIndex
CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");

-- CreateIndex
CREATE INDEX "Feedback_rating_idx" ON "Feedback"("rating");

-- CreateIndex
CREATE INDEX "Waitlist_userId_idx" ON "Waitlist"("userId");

-- CreateIndex
CREATE INDEX "Waitlist_courtConfigId_date_status_idx" ON "Waitlist"("courtConfigId", "date", "status");

-- CreateIndex
CREATE INDEX "EquipmentRental_bookingId_idx" ON "EquipmentRental"("bookingId");

-- CreateIndex
CREATE INDEX "EquipmentRental_equipmentId_idx" ON "EquipmentRental"("equipmentId");

-- CreateIndex
CREATE INDEX "RecurringBooking_userId_idx" ON "RecurringBooking"("userId");

-- CreateIndex
CREATE INDEX "RecurringBooking_status_idx" ON "RecurringBooking"("status");

-- CreateIndex
CREATE INDEX "GeneratorFuelLog_generatorId_idx" ON "GeneratorFuelLog"("generatorId");

-- CreateIndex
CREATE INDEX "GeneratorFuelLog_date_idx" ON "GeneratorFuelLog"("date");

-- CreateIndex
CREATE INDEX "GeneratorOilChange_generatorId_idx" ON "GeneratorOilChange"("generatorId");

-- CreateIndex
CREATE INDEX "GeneratorOilChange_date_idx" ON "GeneratorOilChange"("date");

-- CreateIndex
CREATE INDEX "GeneratorRunLog_generatorId_idx" ON "GeneratorRunLog"("generatorId");

-- CreateIndex
CREATE INDEX "GeneratorRunLog_startTime_idx" ON "GeneratorRunLog"("startTime");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_courtConfigId_fkey" FOREIGN KEY ("courtConfigId") REFERENCES "CourtConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_recurringBookingId_fkey" FOREIGN KEY ("recurringBookingId") REFERENCES "RecurringBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSlot" ADD CONSTRAINT "BookingSlot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_courtConfigId_fkey" FOREIGN KEY ("courtConfigId") REFERENCES "CourtConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotBlock" ADD CONSTRAINT "SlotBlock_courtConfigId_fkey" FOREIGN KEY ("courtConfigId") REFERENCES "CourtConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountUsage" ADD CONSTRAINT "DiscountUsage_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEditHistory" ADD CONSTRAINT "BookingEditHistory_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CafeOrder" ADD CONSTRAINT "CafeOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CafeOrder" ADD CONSTRAINT "CafeOrder_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CafeOrderItem" ADD CONSTRAINT "CafeOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CafeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CafeOrderItem" ADD CONSTRAINT "CafeOrderItem_cafeItemId_fkey" FOREIGN KEY ("cafeItemId") REFERENCES "CafeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CafePayment" ADD CONSTRAINT "CafePayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CafeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CafeDiscountUsage" ADD CONSTRAINT "CafeDiscountUsage_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "CafeDiscount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CafeOrderEditHistory" ADD CONSTRAINT "CafeOrderEditHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CafeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCondition" ADD CONSTRAINT "CouponCondition_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardPointsBalance" ADD CONSTRAINT "RewardPointsBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "RewardPointsBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitlist" ADD CONSTRAINT "Waitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitlist" ADD CONSTRAINT "Waitlist_courtConfigId_fkey" FOREIGN KEY ("courtConfigId") REFERENCES "CourtConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRental" ADD CONSTRAINT "EquipmentRental_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRental" ADD CONSTRAINT "EquipmentRental_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_courtConfigId_fkey" FOREIGN KEY ("courtConfigId") REFERENCES "CourtConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorFuelLog" ADD CONSTRAINT "GeneratorFuelLog_generatorId_fkey" FOREIGN KEY ("generatorId") REFERENCES "Generator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorOilChange" ADD CONSTRAINT "GeneratorOilChange_generatorId_fkey" FOREIGN KEY ("generatorId") REFERENCES "Generator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorRunLog" ADD CONSTRAINT "GeneratorRunLog_generatorId_fkey" FOREIGN KEY ("generatorId") REFERENCES "Generator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

