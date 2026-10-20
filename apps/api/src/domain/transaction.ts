import type { z as zod } from 'zod';

import type { createTransactionSchema } from '@my-wallets/contracts';

import type { VerifiedInstrument } from './instrument.ts';

type TransactionFields = Omit<zod.infer<typeof createTransactionSchema>, 'side'>;

export type CreateTransactionCommand = TransactionFields &
  ({ side: 'BUY'; instrument: VerifiedInstrument } | { side: 'SELL'; instrument?: never });
