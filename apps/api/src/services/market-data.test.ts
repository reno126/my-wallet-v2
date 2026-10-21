import { describe, expect, it, vi } from 'vitest';

import { createMarketCalendar } from '../domain/market-calendar.ts';
import type { MarketDataRepository } from '../repositories/market-data.ts';
import type { createProviderQuotaRepository } from '../repositories/provider-quota.ts';
import { failure, success } from '../result.ts';
import type { createLedgerService } from './ledger.ts';
import { createMarketDataService } from './market-data.ts';

const now = new Date('2026-11-02T17:00:00Z');
function createFixture(configured = true) {
  const wallet = {
    walletId: 'wallet',
    reportingCurrency: 'USD',
    remainingCostBasis: '20',
    realizedProfitLoss: '0',
    lastTransactionDate: '2026-10-18',
    holdings: [
      {
        walletId: 'wallet',
        symbol: 'AAPL',
        name: 'Apple',
        exchange: 'NASDAQ',
        quoteCurrency: 'USD',
        quantity: '2',
        remainingCostBasis: '20',
        averageUnitCost: '10',
        realizedProfitLoss: '0',
        lastTransactionDate: '2026-10-18',
      },
    ],
  } as const;
  const ledger = {
    holdings: vi
      .fn<ReturnType<typeof createLedgerService>['holdings']>()
      .mockResolvedValue(success({ ...wallet, holdings: [...wallet.holdings] })),
  };
  const market = {
    readForSymbols: vi
      .fn<MarketDataRepository['readForSymbols']>()
      .mockResolvedValue({ prices: [], work: [] }),
  };
  const scheduler = {
    requestForWallet: vi
      .fn<(userId: string, walletId: string, symbol: string) => Promise<boolean>>()
      .mockResolvedValue(true),
  };
  const quota = {
    read: vi.fn<ReturnType<typeof createProviderQuotaRepository>['read']>().mockResolvedValue({
      provider: 'FMP',
      limit: 250,
      used: 0,
      remaining: 250,
      quotaDate: '2026-11-02',
      timeZone: 'America/New_York',
      resetsAt: new Date('2026-11-03T05:00:00Z'),
    }),
  };
  const service = createMarketDataService({
    ledger,
    market,
    scheduler,
    quota,
    configured,
    calendar: createMarketCalendar('America/New_York'),
    now: () => now,
  });
  return { wallet, ledger, market, scheduler, quota, service };
}

describe('when serving cached wallet prices and refresh intent', () => {
  it('should check ownership before accessing shared data, quota or scheduling', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.ledger.holdings.mockResolvedValue(failure({ code: 'NOT_FOUND' }));
    // Act
    const results = await Promise.all([
      fixture.service.valuation('other', 'wallet'),
      fixture.service.refreshStatus('other', 'wallet'),
      fixture.service.requestRefresh('other', 'wallet'),
    ]);
    // Assert
    expect(results.every((result) => !result.ok && result.error.code === 'NOT_FOUND')).toBe(true);
    expect(fixture.market.readForSymbols).not.toHaveBeenCalled();
    expect(fixture.quota.read).not.toHaveBeenCalled();
    expect(fixture.scheduler.requestForWallet).not.toHaveBeenCalled();
  });

  it('should keep valuation and status reads free of refresh dispatch and quota access', async () => {
    // Arrange
    const fixture = createFixture();
    // Act
    await fixture.service.valuation('user', 'wallet');
    await fixture.service.refreshStatus('user', 'wallet');
    // Assert
    expect(fixture.market.readForSymbols).toHaveBeenCalledWith(['AAPL']);
    expect(fixture.quota.read).not.toHaveBeenCalled();
    expect(fixture.scheduler.requestForWallet).not.toHaveBeenCalled();
  });

  it('should persist stale open-symbol requests and leave completion to the scheduler', async () => {
    // Arrange
    const fixture = createFixture();
    // Act
    const result = await fixture.service.requestRefresh('user', 'wallet');
    // Assert
    expect(result).toEqual(success({ walletId: 'wallet', requestedSymbols: ['AAPL'] }));
    expect(fixture.scheduler.requestForWallet).toHaveBeenCalledExactlyOnceWith(
      'user',
      'wallet',
      'AAPL',
    );
  });

  it.each(['fresh', 'closed'] as const)(
    'should skip %s holdings without needing provider configuration or quota',
    async (state) => {
      // Arrange
      const fixture = createFixture(false);
      if (state === 'closed') {
        fixture.ledger.holdings.mockResolvedValue(
          success({
            ...fixture.wallet,
            holdings: [
              {
                ...fixture.wallet.holdings[0],
                quantity: '0',
                remainingCostBasis: '0',
                averageUnitCost: null,
              },
            ],
          }),
        );
      } else {
        fixture.market.readForSymbols.mockResolvedValue({
          prices: [
            {
              symbol: 'AAPL',
              unitPrice: '10',
              currency: 'USD',
              marketDate: '2026-11-02',
              retrievedAt: now,
              source: 'FMP',
            },
          ],
          work: [],
        });
      }
      // Act
      const result = await fixture.service.requestRefresh('user', 'wallet');
      // Assert
      expect(result).toEqual(success({ walletId: 'wallet', requestedSymbols: [] }));
      expect(fixture.quota.read).not.toHaveBeenCalled();
      expect(fixture.scheduler.requestForWallet).not.toHaveBeenCalled();
    },
  );

  it('should preserve durable failure and retry status while withholding unrecognized failure strings', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.market.readForSymbols.mockResolvedValue({
      prices: [],
      work: [
        {
          symbol: 'AAPL',
          status: 'PENDING',
          nextAttemptAt: now,
          lastFailureCode: 'PROVIDER_TIMEOUT',
        },
      ],
    });
    // Act
    const pending = await fixture.service.refreshStatus('user', 'wallet');
    fixture.market.readForSymbols.mockResolvedValue({
      prices: [],
      work: [
        {
          symbol: 'AAPL',
          status: 'FAILED',
          nextAttemptAt: now,
          lastFailureCode: 'unsafe-provider-secret',
        },
      ],
    });
    const failed = await fixture.service.refreshStatus('user', 'wallet');
    // Assert
    expect(pending).toMatchObject({
      ok: true,
      value: {
        isSyncing: true,
        holdings: [
          {
            status: 'pending',
            nextAttemptAt: now.toISOString(),
            lastFailureCode: 'PROVIDER_TIMEOUT',
          },
        ],
      },
    });
    expect(failed).toMatchObject({
      ok: true,
      value: { isSyncing: false, holdings: [{ status: 'failed', lastFailureCode: null }] },
    });
  });

  it('should report quota and its reset without making a reservation', async () => {
    // Arrange
    const fixture = createFixture(false);
    // Act
    const result = await fixture.service.quotaStatus();
    // Assert
    expect(result).toMatchObject({
      ok: true,
      value: {
        configured: false,
        remaining: 250,
        exhausted: false,
        resetsAt: '2026-11-03T05:00:00.000Z',
      },
    });
    expect(fixture.scheduler.requestForWallet).not.toHaveBeenCalled();
  });

  it.each([
    'missing provider',
    'exhausted quota',
    'failed quota read',
    'stopped scheduler',
  ] as const)('should report %s without claiming refresh completion', async (scenario) => {
    // Arrange
    const fixture = createFixture(scenario !== 'missing provider');
    if (scenario === 'exhausted quota') {
      fixture.quota.read.mockResolvedValue({
        provider: 'FMP',
        limit: 250,
        used: 250,
        remaining: 0,
        quotaDate: '2026-11-02',
        timeZone: 'America/New_York',
        resetsAt: now,
      });
    }
    if (scenario === 'failed quota read') {
      fixture.quota.read.mockRejectedValue(new Error('private database details'));
    }
    if (scenario === 'stopped scheduler') {
      fixture.scheduler.requestForWallet.mockResolvedValue(false);
    }
    // Act
    const result = await fixture.service.requestRefresh('user', 'wallet');
    // Assert
    expect(result).toEqual(
      failure({
        code: scenario === 'exhausted quota' ? 'PROVIDER_QUOTA_EXHAUSTED' : 'PROVIDER_UNAVAILABLE',
      }),
    );
    if (scenario !== 'stopped scheduler') {
      expect(fixture.scheduler.requestForWallet).not.toHaveBeenCalled();
    }
  });
});
