import { z as zod } from 'zod';

import { apiErrorSchema } from './api-error.js';
import {
  currencyCodeSchema,
  dateOnlySchema,
  decimalStringSchema,
  nonnegativeDecimalStringSchema,
  positiveDecimalStringSchema,
  resourceIdSchema,
  timestampSchema,
} from './common.js';
import { instrumentSymbolSchema } from './instrument.js';
import { holdingSchema, walletHoldingsSchema } from './ledger.js';

export const priceFreshnessSchema = zod.enum(['fresh', 'stale', 'missing', 'not_required']);

export const currentPriceSchema = zod.strictObject({
  unitPrice: positiveDecimalStringSchema,
  currency: currencyCodeSchema,
  marketDate: dateOnlySchema,
  retrievedAt: timestampSchema,
  source: zod.enum(['FMP']),
});

const valuationFields = {
  currentValue: nonnegativeDecimalStringSchema.nullable(),
  unrealizedProfitLoss: decimalStringSchema.nullable(),
  unrealizedProfitLossPercentage: decimalStringSchema
    .nullable()
    .describe(
      'Unrealized P/L divided by remaining FIFO cost, times 100; null without a denominator.',
    ),
  freshness: priceFreshnessSchema,
};

export const holdingValuationSchema = holdingSchema.extend({
  ...valuationFields,
  price: currentPriceSchema.nullable(),
  allocationPercentage: nonnegativeDecimalStringSchema
    .nullable()
    .describe(
      'Share of the complete wallet current value, times 100; null when unavailable or zero.',
    ),
});

export const walletValuationSchema = walletHoldingsSchema.extend({
  ...valuationFields,
  latestPriceUpdateAt: timestampSchema.nullable(),
  holdings: zod.array(holdingValuationSchema),
});

export const holdingRefreshStatusSchema = zod.strictObject({
  symbol: instrumentSymbolSchema,
  freshness: priceFreshnessSchema,
  status: zod.enum(['idle', 'pending', 'running', 'failed', 'succeeded']),
  nextAttemptAt: timestampSchema.nullable(),
  lastFailureCode: apiErrorSchema.shape.error.shape.code.nullable(),
});

export const walletRefreshStatusSchema = zod.strictObject({
  walletId: resourceIdSchema,
  providerConfigured: zod.boolean(),
  freshness: priceFreshnessSchema,
  hasPendingWork: zod
    .boolean()
    .describe(
      'Durable unfinished demand for stale/missing holdings, including retries or lease recovery. Does not imply an active worker or available quota.',
    ),
  holdings: zod.array(holdingRefreshStatusSchema),
});

export const priceRefreshRequestSchema = zod.strictObject({}).nullish();

export const priceRefreshReceiptSchema = zod.strictObject({
  walletId: resourceIdSchema,
  requestedSymbols: zod.array(instrumentSymbolSchema),
});

export const providerQuotaStatusSchema = zod.strictObject({
  provider: zod.enum(['FMP']),
  configured: zod.boolean(),
  quotaDate: dateOnlySchema,
  timeZone: zod.string().min(1),
  limit: zod.number().int().positive(),
  used: zod.number().int().nonnegative(),
  remaining: zod.number().int().nonnegative(),
  exhausted: zod.boolean(),
  resetsAt: timestampSchema,
});
