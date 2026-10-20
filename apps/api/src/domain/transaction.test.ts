import { describe, expectTypeOf, it } from 'vitest';
import type { z as zod } from 'zod';

import type { createTransactionSchema } from '@my-wallets/contracts';

import type { VerifiedInstrument } from './instrument.ts';
import type { CreateTransactionCommand } from './transaction.ts';

type TransactionFields = Omit<zod.infer<typeof createTransactionSchema>, 'side'>;

describe('when preparing a transaction command', () => {
  it('should require verified metadata for a BUY', () => {
    // Assert
    expectTypeOf<TransactionFields & { side: 'BUY' }>().not.toExtend<CreateTransactionCommand>();
    expectTypeOf<
      TransactionFields & { side: 'BUY'; instrument: VerifiedInstrument }
    >().toExtend<CreateTransactionCommand>();
  });

  it('should exclude verified metadata from a SELL', () => {
    // Assert
    expectTypeOf<TransactionFields & { side: 'SELL' }>().toExtend<CreateTransactionCommand>();
    expectTypeOf<
      TransactionFields & { side: 'SELL'; instrument: VerifiedInstrument }
    >().not.toExtend<CreateTransactionCommand>();
  });
});
