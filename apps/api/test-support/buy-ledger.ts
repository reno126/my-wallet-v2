import { randomUUID } from 'node:crypto';

import {
  createInstrumentApiFixture,
  type FakeProviderResponse,
  type InstrumentApiFixtureOptions,
} from './instrument-api.js';
import { createLedgerFixture } from './ledger.ts';

export async function createBuyLedgerFixture(
  profileChanges: Record<string, unknown> = {},
  options: InstrumentApiFixtureOptions & { replies?: readonly FakeProviderResponse[] } = {},
) {
  const symbol = `B${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const profile = {
    symbol,
    companyName: 'Verified stock',
    currency: 'USD',
    exchange: 'NASDAQ',
    isEtf: false,
    isFund: false,
    ...profileChanges,
  };
  const fixture = await createInstrumentApiFixture(
    options.replies ?? Array.from({ length: 8 }, () => ({ body: [profile] })),
    options,
  );
  return createLedgerFixture(fixture, symbol);
}
