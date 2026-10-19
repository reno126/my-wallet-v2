import { describe, expectTypeOf, it } from 'vitest';

import { failure, type Result, success } from './result.js';

describe('when constructing typed results', () => {
  it('should preserve the success branch and mutable payload types', () => {
    // Arrange
    const payload = { symbols: ['AAPL'] };

    // Act
    const result = success(payload);

    // Assert
    expectTypeOf(result.ok).toEqualTypeOf<true>();
    expectTypeOf(result.value).toEqualTypeOf<typeof payload>();
    expectTypeOf(result.value.symbols).toEqualTypeOf<string[]>();
  });

  it('should infer literal failure codes and metadata without a contextual return type', () => {
    // Arrange
    // Act
    const result = failure({ code: 'HTTP_ERROR', status: 503 });

    // Assert
    expectTypeOf(result.ok).toEqualTypeOf<false>();
    expectTypeOf(result.error.code).toEqualTypeOf<'HTTP_ERROR'>();
    expectTypeOf(result.error.status).toEqualTypeOf<503>();
    expectTypeOf(result).toMatchTypeOf<Result<never, { code: 'HTTP_ERROR'; status: number }>>();
  });

  it('should support successful operations with no return value', () => {
    // Arrange
    // Act
    const result = success(undefined);

    // Assert
    expectTypeOf(result.value).toEqualTypeOf<undefined>();
    expectTypeOf(result).toMatchTypeOf<Result<undefined, { code: 'NOT_FOUND' }>>();
  });

  it.each([true, false])(
    'should preserve discriminated-union narrowing when found is %s',
    (found) => {
      // Arrange
      function findWallet(): Result<{ id: string }, { code: 'NOT_FOUND' }> {
        return found ? success({ id: 'wallet-id' }) : failure({ code: 'NOT_FOUND' });
      }

      // Act
      const result = findWallet();

      // Assert
      if (result.ok) {
        expectTypeOf(result.value.id).toEqualTypeOf<string>();
      } else {
        expectTypeOf(result.error.code).toEqualTypeOf<'NOT_FOUND'>();
      }
    },
  );
});
