import type { PrismaClient } from '../../generated/prisma/client.js';
import { createMarketCalendar } from '../domain/market-calendar.ts';

interface ProviderQuotaOptions {
  dailyLimit: number;
  timeZone: string;
  provider?: string;
  now?: () => Date;
}

export type ProviderRequestBudget = ReturnType<typeof createProviderQuotaRepository>;

export function createProviderQuotaRepository(prisma: PrismaClient, options: ProviderQuotaOptions) {
  if (
    !Number.isInteger(options.dailyLimit) ||
    options.dailyLimit < 1 ||
    options.dailyLimit > 1_000_000
  ) {
    throw new RangeError('The daily provider limit must be an integer from 1 to 1000000.');
  }
  const provider = options.provider ?? 'FMP';
  const now = options.now ?? (() => new Date());
  const calendar = createMarketCalendar(options.timeZone);

  async function ensurePolicy() {
    await prisma.$executeRaw`
      INSERT INTO "provider_budget" ("provider", "dailyLimit", "timeZone")
      VALUES (${provider}, ${options.dailyLimit}, ${options.timeZone})
      ON CONFLICT ("provider") DO NOTHING
    `;
    const policy = await prisma.providerBudget.findUniqueOrThrow({ where: { provider } });
    if (policy.dailyLimit !== options.dailyLimit || policy.timeZone !== options.timeZone) {
      // A differently configured process must not create a second budget or raise its allowance.
      throw new Error('Provider budget configuration does not match its persisted policy.');
    }
    return policy;
  }

  return {
    reserveRequest: async (): Promise<boolean> => {
      const policy = await ensurePolicy();
      const quotaDate = new Date(`${calendar.date(now())}T00:00:00.000Z`);
      const reserved = await prisma.$queryRaw<Array<{ used: number }>>`
        INSERT INTO "provider_quota_day" ("provider", "quotaDate", "used")
        VALUES (${provider}, ${quotaDate}, 1)
        ON CONFLICT ("provider", "quotaDate") DO UPDATE
        SET "used" = "provider_quota_day"."used" + 1
        WHERE "provider_quota_day"."used" < ${policy.dailyLimit}
        RETURNING "used"
      `;
      return reserved.length === 1;
    },
    read: async () => {
      const policy = await ensurePolicy();
      const instant = now();
      const quotaDate = calendar.date(instant);
      const day = await prisma.providerQuotaDay.findUnique({
        where: {
          provider_quotaDate: { provider, quotaDate: new Date(`${quotaDate}T00:00:00.000Z`) },
        },
      });
      const used = day?.used ?? 0;
      return {
        provider,
        quotaDate,
        timeZone: policy.timeZone,
        limit: policy.dailyLimit,
        used,
        remaining: Math.max(0, policy.dailyLimit - used),
        resetsAt: calendar.nextReset(instant),
      };
    },
  };
}
