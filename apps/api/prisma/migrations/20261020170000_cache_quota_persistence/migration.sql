BEGIN;

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('FMP');

-- CreateEnum
CREATE TYPE "RefreshStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "provider_budget" (
    "provider" VARCHAR(50) NOT NULL,
    "dailyLimit" INTEGER NOT NULL,
    "timeZone" VARCHAR(100) NOT NULL,

    CONSTRAINT "provider_budget_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "provider_quota_day" (
    "provider" VARCHAR(50) NOT NULL,
    "quotaDate" DATE NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "provider_quota_day_pkey" PRIMARY KEY ("provider","quotaDate")
);

-- CreateTable
CREATE TABLE "price_snapshot" (
    "symbol" VARCHAR(40) NOT NULL,
    "marketDate" DATE NOT NULL,
    "unitPrice" DECIMAL(30,8) NOT NULL,
    "currency" "CurrencyCode" NOT NULL,
    "source" "PriceSource" NOT NULL,
    "retrievedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_snapshot_pkey" PRIMARY KEY ("symbol","marketDate")
);

-- CreateTable
CREATE TABLE "refresh_work" (
    "symbol" VARCHAR(40) NOT NULL,
    "status" "RefreshStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3),
    "lastFailureCode" VARCHAR(50),

    CONSTRAINT "refresh_work_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "refresh_subscription" (
    "walletId" UUID NOT NULL,
    "symbol" VARCHAR(40) NOT NULL,

    CONSTRAINT "refresh_subscription_pkey" PRIMARY KEY ("walletId","symbol")
);

-- CreateIndex
CREATE INDEX "refresh_work_status_nextAttemptAt_idx" ON "refresh_work"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "refresh_work_leaseExpiresAt_idx" ON "refresh_work"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "refresh_subscription_symbol_idx" ON "refresh_subscription"("symbol");

-- AddForeignKey
ALTER TABLE "provider_quota_day" ADD CONSTRAINT "provider_quota_day_provider_fkey" FOREIGN KEY ("provider") REFERENCES "provider_budget"("provider") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_subscription" ADD CONSTRAINT "refresh_subscription_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_subscription" ADD CONSTRAINT "refresh_subscription_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "refresh_work"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_budget" ADD CONSTRAINT "provider_budget_positive_limit"
  CHECK ("dailyLimit" BETWEEN 1 AND 1000000);
ALTER TABLE "provider_quota_day" ADD CONSTRAINT "provider_quota_day_nonnegative_used"
  CHECK ("used" >= 0);
ALTER TABLE "price_snapshot" ADD CONSTRAINT "price_snapshot_positive_price"
  CHECK ("unitPrice" > 0 AND "unitPrice" <> 'NaN'::numeric);
ALTER TABLE "refresh_work" ADD CONSTRAINT "refresh_work_nonnegative_attempts"
  CHECK ("attempts" >= 0);
ALTER TABLE "refresh_work" ADD CONSTRAINT "refresh_work_lease_consistency"
  CHECK (("status" = 'RUNNING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL));

COMMIT;
