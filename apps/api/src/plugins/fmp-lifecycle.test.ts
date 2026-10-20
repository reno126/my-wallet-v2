import Fastify from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestServer } from '../../test-support/create-test-server.ts';
import * as recoveryModule from '../services/price-refresh-recovery.ts';
import fmpPlugin from './fmp.ts';

describe('when connecting refresh recovery to Fastify lifecycle hooks', () => {
  it.each([
    ['configured provider', 'test-only-key', true, 1],
    ['disabled background recovery', 'test-only-key', false, 0],
    ['missing provider key', '', true, 0],
  ] as const)(
    'should honor %s at startup and always stop on close',
    async (_description, key, enabled, starts) => {
      // Arrange
      const recovery = {
        start: vi.fn<() => Promise<void>>().mockResolvedValue(),
        stop: vi.fn<() => Promise<void>>().mockResolvedValue(),
      };
      vi.spyOn(recoveryModule, 'createPriceRefreshRecovery').mockReturnValueOnce(recovery);
      const database = createTestServer({ FMP_API_KEY: key });
      await database.ready();
      const server = Fastify();
      server.register(
        fastifyPlugin(
          (instance, _options, done) => {
            instance.decorate('prisma', database.prisma);
            done();
          },
          { name: 'api-prisma' },
        ),
      );
      server.register(fmpPlugin, {
        environment: database.apiEnvironment,
        recoverRefreshWork: enabled,
      });
      onTestFinished(async () => {
        await server.close();
        await database.close();
      });

      // Act
      await server.ready();
      await server.close();

      // Assert
      expect(recovery.start).toHaveBeenCalledTimes(starts);
      expect(recovery.stop).toHaveBeenCalled();
      expect(await server.priceRefresh.requestForWallet('user', 'wallet', 'AAPL')).toBe(false);
    },
  );
});
