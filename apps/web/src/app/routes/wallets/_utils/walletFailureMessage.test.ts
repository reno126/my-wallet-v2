import { describe, expect, it } from 'vitest';

import type { WalletApiFailure } from '@/lib/api/wallets';

import { walletDictionary } from '../walletDictionary';
import { walletFailureMessage } from './walletFailureMessage';

describe('wallet failure messages', () => {
  it.each<WalletApiFailure>([
    { kind: 'network' },
    { kind: 'invalid-response' },
    { kind: 'http', status: 503 },
  ])('should use the standard message for %j when no unconfirmed message is supplied', (error) => {
    // Arrange
    const messages = { failed: walletDictionary.page.loadFailed };
    // Act
    const message = walletFailureMessage(error, messages);
    // Assert
    expect(message).toBe(walletDictionary.page.loadFailed);
  });
});
