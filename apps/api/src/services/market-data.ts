import type { z as zod } from 'zod';

import {
  apiErrorSchema,
  type priceRefreshReceiptSchema,
  type providerQuotaStatusSchema,
  type walletRefreshStatusSchema,
} from '@my-wallets/contracts';

import type { createMarketCalendar } from '../domain/market-calendar.ts';
import type { ApiFailure } from '../http/api-failure.ts';
import type { MarketDataRepository } from '../repositories/market-data.ts';
import type { createProviderQuotaRepository } from '../repositories/provider-quota.ts';
import { failure, type Result, success } from '../result.ts';
import { assessHoldingPrices, walletPriceFreshness } from './holding-prices.ts';
import type { createLedgerService } from './ledger.ts';
import type { createPriceRefreshScheduler } from './price-refresh-scheduler.ts';
import { valueWalletHoldings } from './wallet-valuation.ts';

interface MarketDataOptions {
  ledger: Pick<ReturnType<typeof createLedgerService>, 'holdings'>;
  market: MarketDataRepository;
  scheduler: Pick<ReturnType<typeof createPriceRefreshScheduler>, 'requestForWallet'>;
  quota: Pick<ReturnType<typeof createProviderQuotaRepository>, 'read'>;
  calendar: ReturnType<typeof createMarketCalendar>;
  configured: boolean;
  now?: () => Date;
}

type RefreshStatus = zod.infer<typeof walletRefreshStatusSchema>;
type RefreshReceipt = zod.infer<typeof priceRefreshReceiptSchema>;
type QuotaStatus = zod.infer<typeof providerQuotaStatusSchema>;
const workStatuses = {
  PENDING: 'pending',
  RUNNING: 'running',
  FAILED: 'failed',
  SUCCEEDED: 'succeeded',
} as const;

export function createMarketDataService(options: MarketDataOptions) {
  const now = options.now ?? (() => new Date());
  return { valuation, holdingValuation, refreshStatus, requestRefresh, quotaStatus };

  async function read(userId: string, walletId: string, mode: 'prices' | 'refresh-status') {
    const ledger = await options.ledger.holdings(userId, walletId);
    if (!ledger.ok) {
      return ledger;
    }
    const symbols = ledger.value.holdings
      .filter((holding) => holding.quantity !== '0')
      .map((holding) => holding.symbol);
    const market =
      mode === 'refresh-status'
        ? await options.market.readForSymbols(symbols)
        : { prices: await options.market.latestPricesForSymbols(symbols), work: [] };
    return success({
      ledger: ledger.value,
      ...market,
    });
  }

  async function valuation(userId: string, walletId: string) {
    const result = await read(userId, walletId, 'prices');
    return result.ok
      ? success(
          valueWalletHoldings(result.value.ledger, result.value.prices, now(), options.calendar),
        )
      : result;
  }

  async function holdingValuation(userId: string, walletId: string, symbol: string) {
    const result = await valuation(userId, walletId);
    if (!result.ok) {
      return result;
    }
    const holding = result.value.holdings.find(
      (holding) => holding.symbol === symbol.toUpperCase(),
    );
    return holding ? success(holding) : failure({ code: 'NOT_FOUND' });
  }

  async function refreshStatus(
    userId: string,
    walletId: string,
  ): Promise<Result<RefreshStatus, ApiFailure>> {
    const result = await read(userId, walletId, 'refresh-status');
    if (!result.ok) {
      return result;
    }
    const { ledger, prices, work } = result.value;
    const instant = now();
    const priceStates = assessHoldingPrices(ledger.holdings, prices, instant, options.calendar);
    const bySymbol = new Map(work.map((row) => [row.symbol, row]));
    const holdings = priceStates.map(
      ({ holding, freshness }): RefreshStatus['holdings'][number] => {
        const row = bySymbol.get(holding.symbol);
        const parsedCode = apiErrorSchema.shape.error.shape.code.safeParse(row?.lastFailureCode);
        return {
          symbol: holding.symbol,
          freshness,
          status:
            row?.status === 'RUNNING' && (!row.leaseExpiresAt || row.leaseExpiresAt <= instant)
              ? 'pending'
              : row
                ? workStatuses[row.status]
                : 'idle',
          nextAttemptAt: row?.nextAttemptAt?.toISOString() ?? null,
          lastFailureCode: parsedCode.success ? parsedCode.data : null,
        };
      },
    );
    return success({
      walletId,
      providerConfigured: options.configured,
      freshness: walletPriceFreshness(priceStates),
      hasPendingWork: holdings.some(
        (holding) =>
          (holding.freshness === 'stale' || holding.freshness === 'missing') &&
          (holding.status === 'pending' || holding.status === 'running'),
      ),
      holdings,
    });
  }

  async function quotaStatus(): Promise<Result<QuotaStatus, ApiFailure>> {
    try {
      const quota = await options.quota.read();
      return success({
        ...quota,
        provider: 'FMP',
        configured: options.configured,
        exhausted: quota.remaining === 0,
        resetsAt: quota.resetsAt.toISOString(),
      });
    } catch {
      return failure({ code: 'PROVIDER_UNAVAILABLE' });
    }
  }

  async function requestRefresh(
    userId: string,
    walletId: string,
  ): Promise<Result<RefreshReceipt, ApiFailure>> {
    const result = await read(userId, walletId, 'prices');
    if (!result.ok) {
      return result;
    }
    const stale = assessHoldingPrices(
      result.value.ledger.holdings,
      result.value.prices,
      now(),
      options.calendar,
    ).filter((state) => state.freshness === 'stale' || state.freshness === 'missing');
    if (stale.length === 0) {
      return success({ walletId, requestedSymbols: [] });
    }
    if (!options.configured) {
      return failure({ code: 'PROVIDER_UNAVAILABLE' });
    }
    const quota = await quotaStatus();
    if (!quota.ok) {
      return quota;
    }
    if (quota.value.exhausted) {
      return failure({ code: 'PROVIDER_QUOTA_EXHAUSTED' });
    }
    const requestedSymbols: string[] = [];
    for (const { holding } of stale) {
      if (!(await options.scheduler.requestForWallet(userId, walletId, holding.symbol))) {
        return failure({ code: 'PROVIDER_UNAVAILABLE' });
      }
      requestedSymbols.push(holding.symbol);
    }
    return success({ walletId, requestedSymbols });
  }
}
