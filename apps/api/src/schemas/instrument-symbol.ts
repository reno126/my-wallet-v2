import { instrumentSymbolSchema } from '@my-wallets/contracts';

export const normalizedInstrumentSymbolSchema = instrumentSymbolSchema.transform((symbol) =>
  symbol.toUpperCase(),
);
