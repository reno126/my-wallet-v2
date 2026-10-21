import { PrismaPg } from '@prisma/adapter-pg';
import Fastify from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { PrismaClient } from '../../generated/prisma/client.js';
import { createTestProviderBudget } from '../../test-support/provider-budget.ts';
import { apiEnvironmentSchema } from '../config/environment.ts';
import fmpPlugin from './fmp.ts';

describe('when composing an injected provider budget', () => {
  it.each([false, true])(
    'should share reservations, status and recovery with an initially exhausted budget: %s',
    async (exhaustedAtStartup) => {
      // Arrange
      const environment = apiEnvironmentSchema.parse({
        NODE_ENV: 'test',
        FMP_API_KEY: 'test-only-key',
        DATABASE_URL: 'postgresql://127.0.0.1:1/wallet_test',
      });
      const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }),
      });
      const budget = createTestProviderBudget(1);
      if (exhaustedAtStartup) {
        await budget.reserveRequest();
      }
      const read = vi.spyOn(budget, 'read');
      const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json([
          {
            symbol: 'AAPL',
            companyName: 'Apple',
            currency: 'USD',
            exchange: 'NASDAQ',
            isEtf: false,
            isFund: false,
          },
        ]),
      );
      const server = Fastify({ logger: false });
      server.register(
        fastifyPlugin(
          (instance, _options, done) => {
            instance.decorate('prisma', prisma);
            instance.addHook('onClose', async () => prisma.$disconnect());
            done();
          },
          { name: 'api-prisma' },
        ),
      );
      server.register(fmpPlugin, {
        environment,
        recoverRefreshWork: exhaustedAtStartup,
        fmp: { budget, fetch: fetchRequest },
      });
      onTestFinished(async () => server.close());
      // Act
      await server.ready();
      const first = await server.instrumentVerifier.verify('AAPL');
      const status = await server.marketData.quotaStatus();
      const second = await server.instrumentVerifier.verify('AAPL');
      // Assert
      expect(first.ok).toBe(!exhaustedAtStartup);
      expect(status).toMatchObject({
        ok: true,
        value: { limit: 1, used: 1, remaining: 0, exhausted: true },
      });
      expect(second).toEqual({ ok: false, error: { code: 'PROVIDER_QUOTA_EXHAUSTED' } });
      expect(fetchRequest).toHaveBeenCalledTimes(exhaustedAtStartup ? 0 : 1);
      expect(read).toHaveBeenCalledTimes(exhaustedAtStartup ? 2 : 1);
    },
  );
});
