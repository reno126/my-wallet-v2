-- CreateEnum
CREATE TYPE "TransactionSide" AS ENUM ('BUY');

-- CreateTable
CREATE TABLE "instrument" (
    "symbol" VARCHAR(40) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "exchange" VARCHAR(100) NOT NULL,
    "quoteCurrency" "CurrencyCode" NOT NULL,

    CONSTRAINT "instrument_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "ledger_transaction" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "symbol" VARCHAR(40) NOT NULL,
    "side" "TransactionSide" NOT NULL,
    "transactionDate" DATE NOT NULL,
    "quantity" DECIMAL(30,8) NOT NULL,
    "unitPrice" DECIMAL(30,8) NOT NULL,
    "currency" "CurrencyCode" NOT NULL,
    "description" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_transaction_walletId_symbol_transactionDate_createdA_idx" ON "ledger_transaction"("walletId", "symbol", "transactionDate", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instrument"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reject invalid financial values even for writes outside the HTTP boundary.
ALTER TABLE "ledger_transaction"
    ADD CONSTRAINT "ledger_transaction_quantity_positive" CHECK ("quantity" > 0 AND "quantity" <> 'NaN'::numeric),
    ADD CONSTRAINT "ledger_transaction_unit_price_positive" CHECK ("unitPrice" > 0 AND "unitPrice" <> 'NaN'::numeric);

-- Corrections use deletion/re-entry in a later slice; existing entries cannot be edited.
CREATE FUNCTION reject_ledger_transaction_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Ledger transactions cannot be edited' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ledger_transaction_immutable"
BEFORE UPDATE ON "ledger_transaction"
FOR EACH ROW EXECUTE FUNCTION reject_ledger_transaction_update();
