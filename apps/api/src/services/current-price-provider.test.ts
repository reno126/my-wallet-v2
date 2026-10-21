import { describe, expectTypeOf, it } from 'vitest';

import type { RefreshFailure } from './current-price-provider.ts';

describe('when defining refresh failure contracts', () => {
  it('should allow transient retry decisions only for provider errors and timeouts', () => {
    // Arrange
    // Act
    // Assert
    expectTypeOf<{ code: 'PROVIDER_ERROR'; retryable: true }>().toExtend<RefreshFailure>();
    expectTypeOf<{ code: 'PROVIDER_TIMEOUT'; retryable: true }>().toExtend<RefreshFailure>();
    expectTypeOf<{
      code: 'PROVIDER_QUOTA_EXHAUSTED';
      retryable: true;
    }>().not.toExtend<RefreshFailure>();
    expectTypeOf<{
      code: 'UNSUPPORTED_CURRENCY';
      retryable: true;
    }>().not.toExtend<RefreshFailure>();
    expectTypeOf<{
      code: 'PROVIDER_PAYMENT_REQUIRED';
      retryable: true;
    }>().not.toExtend<RefreshFailure>();
  });

  it('should exclude authentication and transaction failures from quote results', () => {
    // Arrange
    // Act
    // Assert
    expectTypeOf<{ code: 'UNAUTHENTICATED'; retryable: false }>().not.toExtend<RefreshFailure>();
    expectTypeOf<{
      code: 'INSUFFICIENT_HOLDING';
      retryable: false;
    }>().not.toExtend<RefreshFailure>();
  });
});
