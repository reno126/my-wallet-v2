import { describe, expect, it } from 'vitest';

import { apiErrorSchema, transactionResultSchema } from '@my-wallets/contracts';

import { createBuyLedgerFixture } from '../../test-support/buy-ledger.js';
import { runQueuedLedgerWrites } from '../../test-support/queued-ledger-writes.ts';

describe('when transaction creation and deletion compete for a wallet lock', () => {
  it.each([
    {
      side: 'BUY',
      firstWrite: 'creation',
      quantity: '1',
      realizedProfitLoss: '5',
      deletionStatus: 409,
    },
    {
      side: 'BUY',
      firstWrite: 'deletion',
      quantity: '2',
      realizedProfitLoss: '0',
      deletionStatus: 204,
    },
    {
      side: 'SELL',
      firstWrite: 'creation',
      quantity: '0',
      realizedProfitLoss: '15',
      deletionStatus: 409,
    },
    {
      side: 'SELL',
      firstWrite: 'deletion',
      quantity: '1',
      realizedProfitLoss: '10',
      deletionStatus: 204,
    },
  ])(
    'should serialize $side with $firstWrite queued first and recheck latest eligibility',
    async ({ side, firstWrite, quantity, realizedProfitLoss, deletionStatus }) => {
      // Arrange
      const fixture = await createBuyLedgerFixture();
      await fixture.seedTransaction({
        quantity: side === 'BUY' ? '1' : '2',
        transactionDate: new Date('2026-10-15'),
      });
      const oldSale = await fixture.seedTransaction({
        side: 'SELL',
        unitPrice: '15',
        transactionDate: new Date('2026-10-16'),
      });
      const create = () =>
        side === 'BUY'
          ? fixture.buy({ quantity: '1', unitPrice: '20', transactionDate: '2026-10-17' })
          : fixture.sell({ quantity: '1', unitPrice: '20', transactionDate: '2026-10-17' });
      const remove = () => fixture.deleteTransaction(oldSale.id);
      // Act
      const [first, second] = await runQueuedLedgerWrites(
        fixture.server.prisma,
        fixture.wallet.id,
        2,
        async (waitForQueued) => {
          const pendingFirst = firstWrite === 'creation' ? create() : remove();
          await waitForQueued(1);
          const pendingSecond = firstWrite === 'creation' ? remove() : create();
          return Promise.all([pendingFirst, pendingSecond]);
        },
      );
      const creation = firstWrite === 'creation' ? first : second;
      const deletion = firstWrite === 'creation' ? second : first;
      const remaining = await fixture.readPosition();
      // Assert
      expect(creation.statusCode).toBe(201);
      expect(deletion.statusCode).toBe(deletionStatus);
      if (deletion.statusCode === 409) {
        expect(apiErrorSchema.parse(deletion.json()).error.code).toBe('CONFLICT');
      }
      expect(transactionResultSchema.parse(creation.json()).holding.quantity).toBe(quantity);
      expect(remaining).toMatchObject({ quantity, realizedProfitLoss });
      expect(
        await fixture.server.prisma.ledgerTransaction.findUnique({ where: { id: oldSale.id } }),
      ).toEqual(firstWrite === 'creation' ? oldSale : null);
      expect(fixture.used()).toBe(side === 'BUY' ? 1 : 0);
    },
  );

  it.each(['sale', 'deletion'])(
    'should prevent overselling when %s is queued before deletion of the funding purchase',
    async (firstWrite) => {
      // Arrange
      const fixture = await createBuyLedgerFixture();
      const buy = await fixture.seedTransaction({ transactionDate: new Date('2026-10-16') });
      const sell = () => fixture.sell({ quantity: '1', transactionDate: '2026-10-17' });
      const remove = () => fixture.deleteTransaction(buy.id);
      // Act
      const [first, second] = await runQueuedLedgerWrites(
        fixture.server.prisma,
        fixture.wallet.id,
        2,
        async (waitForQueued) => {
          const pendingFirst = firstWrite === 'sale' ? sell() : remove();
          await waitForQueued(1);
          return Promise.all([pendingFirst, firstWrite === 'sale' ? remove() : sell()]);
        },
      );
      const sale = firstWrite === 'sale' ? first : second;
      const deletion = firstWrite === 'sale' ? second : first;
      // Assert
      expect(sale.statusCode).toBe(firstWrite === 'sale' ? 201 : 409);
      expect(deletion.statusCode).toBe(firstWrite === 'sale' ? 409 : 204);
      if (sale.statusCode === 409) {
        expect(apiErrorSchema.parse(sale.json()).error.code).toBe('INSUFFICIENT_HOLDING');
      } else {
        expect(apiErrorSchema.parse(deletion.json()).error.code).toBe('CONFLICT');
      }
      expect(
        await fixture.server.prisma.ledgerTransaction.count({
          where: { walletId: fixture.wallet.id },
        }),
      ).toBe(firstWrite === 'sale' ? 2 : 0);
      expect((await fixture.readPosition()).quantity).toBe('0');
      expect(fixture.used()).toBe(0);
    },
  );

  it('should delete a transaction once when two deletion requests are queued', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const row = await fixture.seedTransaction();
    // Act
    const responses = await runQueuedLedgerWrites(fixture.server.prisma, fixture.wallet.id, 2, () =>
      Promise.all([fixture.deleteTransaction(row.id), fixture.deleteTransaction(row.id)]),
    );
    // Assert
    expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 404]);
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(0);
    expect(
      await fixture.server.prisma.instrument.count({ where: { symbol: fixture.symbol } }),
    ).toBe(1);
  });

  it.each(['older', 'latest'])(
    'should evaluate eligibility under the lock when the %s deletion is queued first',
    async (firstWrite) => {
      // Arrange
      const fixture = await createBuyLedgerFixture();
      const older = await fixture.seedTransaction({ transactionDate: new Date('2026-10-16') });
      const latest = await fixture.seedTransaction({ transactionDate: new Date('2026-10-17') });
      // Act
      const [first, second] = await runQueuedLedgerWrites(
        fixture.server.prisma,
        fixture.wallet.id,
        2,
        async (waitForQueued) => {
          const pendingFirst = fixture.deleteTransaction(
            firstWrite === 'older' ? older.id : latest.id,
          );
          await waitForQueued(1);
          return Promise.all([
            pendingFirst,
            fixture.deleteTransaction(firstWrite === 'older' ? latest.id : older.id),
          ]);
        },
      );
      // Assert
      expect(first.statusCode).toBe(firstWrite === 'older' ? 409 : 204);
      expect(second.statusCode).toBe(204);
      expect(
        await fixture.server.prisma.ledgerTransaction.count({
          where: { walletId: fixture.wallet.id },
        }),
      ).toBe(firstWrite === 'older' ? 1 : 0);
    },
  );

  it('should coordinate transaction deletion with permanent wallet deletion while retaining shared metadata', async () => {
    // Arrange
    const fixture = await createBuyLedgerFixture();
    const row = await fixture.seedTransaction();
    // Act
    const [transactionDeletion, walletDeletion] = await runQueuedLedgerWrites(
      fixture.server.prisma,
      fixture.wallet.id,
      2,
      () =>
        Promise.all([
          fixture.deleteTransaction(row.id),
          fixture.server.inject({
            method: 'DELETE',
            url: `/api/wallets/${fixture.wallet.id}`,
            headers: fixture.headers,
          }),
        ]),
    );
    // Assert
    fixture.contract.assertResponse('delete', `/api/wallets/${fixture.wallet.id}`, walletDeletion);
    expect(walletDeletion.statusCode).toBe(204);
    expect([204, 404]).toContain(transactionDeletion.statusCode);
    expect(
      await fixture.server.prisma.wallet.findUnique({ where: { id: fixture.wallet.id } }),
    ).toBeNull();
    expect(
      await fixture.server.prisma.ledgerTransaction.count({
        where: { walletId: fixture.wallet.id },
      }),
    ).toBe(0);
    expect(
      await fixture.server.prisma.instrument.count({ where: { symbol: fixture.symbol } }),
    ).toBe(1);
  });
});
