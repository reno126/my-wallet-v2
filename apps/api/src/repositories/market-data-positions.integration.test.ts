import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { createMarketDataFixture } from '../../test-support/market-data.ts';
import { createMarketDataRepository } from './market-data.ts';

async function createFixture() {
  const fixture = await createMarketDataFixture();
  const wallet = await fixture.server.prisma.wallet.findUniqueOrThrow({
    where: { id: fixture.wallet.id },
    select: { userId: true },
  });
  return {
    ...fixture,
    userId: wallet.userId,
    market: createMarketDataRepository(fixture.server.prisma),
  };
}

describe('when reading price-refresh positions without replaying accounting', () => {
  it('should distinguish empty owned wallets from missing and foreign wallets', async () => {
    // Arrange
    const fixture = await createFixture();
    // Act
    const owned = await fixture.market.readWalletPositions(fixture.userId, fixture.wallet.id);
    const missing = await fixture.market.readWalletPositions(fixture.userId, randomUUID());
    const foreign = await fixture.market.readWalletPositions('another-user', fixture.wallet.id);
    // Assert
    expect(owned).toEqual({ walletId: fixture.wallet.id, holdings: [] });
    expect(missing).toBeNull();
    expect(foreign).toBeNull();
  });

  it('should aggregate exact BUY-minus-SELL quantities and retain closed positions within one wallet', async () => {
    // Arrange
    const fixture = await createFixture();
    await fixture.seedTransaction({ quantity: '9007199254740993.00000001' });
    await fixture.seedTransaction({
      side: 'SELL',
      quantity: '9007199254740993',
      transactionDate: new Date('2026-10-19'),
    });
    const closedSymbol = `C${randomUUID().replaceAll('-', '').toUpperCase()}`;
    await fixture.seedTransaction({ symbol: closedSymbol, quantity: '0.12345678' });
    await fixture.seedTransaction({
      symbol: closedSymbol,
      side: 'SELL',
      quantity: '0.12345678',
      transactionDate: new Date('2026-10-19'),
    });
    const otherWallet = await fixture.createWallet(fixture.headers);
    await fixture.seedTransaction({ walletId: otherWallet.id, quantity: '99' });
    // Act
    const positions = await fixture.market.readWalletPositions(fixture.userId, fixture.wallet.id);
    const status = await fixture.server.marketData.refreshStatus(fixture.userId, fixture.wallet.id);
    // Assert
    expect(positions?.holdings).toEqual(
      [
        { symbol: fixture.symbol, quantity: '0.00000001' },
        { symbol: closedSymbol, quantity: '0' },
      ].sort((left, right) => left.symbol.localeCompare(right.symbol)),
    );
    expect(status.ok).toBe(true);
    expect(
      status.ok && status.value.holdings.find((holding) => holding.symbol === fixture.symbol),
    ).toMatchObject({ freshness: 'missing' });
    expect(
      status.ok && status.value.holdings.find((holding) => holding.symbol === closedSymbol),
    ).toMatchObject({ freshness: 'not_required' });
  });

  it('should return bounded position data for a large ledger and measure status against full valuation', async () => {
    // Arrange
    const fixture = await createFixture();
    await fixture.seedTransaction();
    await fixture.server.prisma.ledgerTransaction.createMany({
      data: Array.from({ length: 9_999 }, () => ({
        walletId: fixture.wallet.id,
        symbol: fixture.symbol,
        side: 'BUY',
        quantity: '0.00000001',
        unitPrice: '10',
        currency: 'USD',
        transactionDate: new Date('2026-10-18'),
      })),
    });
    // Act
    const statusStart = performance.now();
    for (let sample = 0; sample < 5; sample += 1) {
      const status = await fixture.server.marketData.refreshStatus(
        fixture.userId,
        fixture.wallet.id,
      );
      expect(status.ok).toBe(true);
    }
    const statusMs = performance.now() - statusStart;
    const valuationStart = performance.now();
    for (let sample = 0; sample < 5; sample += 1) {
      const valuation = await fixture.server.marketData.valuation(
        fixture.userId,
        fixture.wallet.id,
      );
      expect(valuation.ok).toBe(true);
    }
    const valuationMs = performance.now() - valuationStart;
    const positions = await fixture.market.readWalletPositions(fixture.userId, fixture.wallet.id);
    // Assert
    expect(positions?.holdings).toEqual([{ symbol: fixture.symbol, quantity: '1.00009999' }]);
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
    console.info(JSON.stringify({ ledgerRows: 10_000, samples: 5, statusMs, valuationMs }));
  }, 45_000);
});
