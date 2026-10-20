import { describe, expect, it } from 'vitest';

import { apiErrorSchema, transactionResultSchema } from '@my-wallets/contracts';

import { createBuyLedgerFixture } from '../../test-support/buy-ledger.js';
import { runQueuedLedgerWrites } from '../../test-support/queued-ledger-writes.ts';

describe('when stock trades compete for the same wallet ledger', () => {
  it('should commit only one competing overselling request and roll back the loser', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '1', transactionDate: '2026-10-17' });
    // Act
    const responses = await runQueuedLedgerWrites(fixture.server.prisma, fixture.wallet.id, 2, () =>
      Promise.all([fixture.sell({ quantity: '0.6' }), fixture.sell({ quantity: '0.6' })]),
    );
    const sales = await fixture.server.prisma.ledgerTransaction.findMany({
      where: { walletId: fixture.wallet.id, side: 'SELL' },
    });
    // Assert
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    for (const response of responses) {
      if (response.statusCode === 201) {
        expect(transactionResultSchema.parse(response.json()).holding.quantity).toBe('0.4');
      } else {
        expect(apiErrorSchema.parse(response.json()).error.code).toBe('INSUFFICIENT_HOLDING');
      }
    }
    expect(sales).toHaveLength(1);
    expect(sales[0]?.quantity.toFixed()).toBe('0.6');
    expect(fixture.used()).toBe(1);
  });

  it('should commit valid competing sales against the inventory left by the prior commit', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '1', transactionDate: '2026-10-17' });
    // Act
    const responses = await runQueuedLedgerWrites(fixture.server.prisma, fixture.wallet.id, 2, () =>
      Promise.all([fixture.sell({ quantity: '0.4' }), fixture.sell({ quantity: '0.6' })]),
    );
    // Assert
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    const quantities = responses.map(
      (response) => transactionResultSchema.parse(response.json()).holding.quantity,
    );
    expect(quantities).toContain('0');
    expect(quantities.some((quantity) => quantity === '0.4' || quantity === '0.6')).toBe(true);
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id, side: 'SELL' },
      }),
    ).toBe(2);
  });

  it('should serialize purchases and sales through the same wallet lock', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    await fixture.buy({ quantity: '1', transactionDate: '2026-10-16' });
    // Act
    const responses = await runQueuedLedgerWrites(fixture.server.prisma, fixture.wallet.id, 2, () =>
      Promise.all([
        fixture.buy({ quantity: '0.00000001', transactionDate: '2026-10-17' }),
        fixture.sell({ quantity: '1', transactionDate: '2026-10-18' }),
      ]),
    );
    const finalSale = await fixture.sell({ quantity: '0.00000001', transactionDate: '2026-10-19' });
    // Assert
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(finalSale.statusCode).toBe(201);
    expect(transactionResultSchema.parse(finalSale.json()).holding.quantity).toBe('0');
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(4);
    expect(fixture.used()).toBe(2);
  });
});
