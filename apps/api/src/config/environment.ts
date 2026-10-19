import { isIP } from 'node:net';

import { z as zod } from 'zod';

import { fmpApiKeySchema, fmpBaseUrlSchema } from '../providers/fmp/configuration.js';

const localDevelopmentDatabaseUrl =
  'postgresql://wallet_local:wallet_local_only@127.0.0.1:5432/wallet_dev?schema=public';
const testOnlyAuthSecret = 'test-only-secret-that-is-never-valid-in-production';
const localBetterAuthUrl = 'http://127.0.0.1:3000';
const localWebOrigin = 'http://localhost:5173';

const exactHttpOriginSchema = zod.url().refine((value) => {
  try {
    const parsedOrigin = new URL(value);

    return ['http:', 'https:'].includes(parsedOrigin.protocol) && parsedOrigin.origin === value;
  } catch {
    return false;
  }
}, 'Value must be an exact HTTP or HTTPS origin without a path.');

export const apiEnvironmentSchema = zod
  .object({
    NODE_ENV: zod.enum(['development', 'test', 'production']).default('development'),
    API_HOST: zod.string().trim().min(1).default('127.0.0.1'),
    PORT: zod.coerce.number().int().min(1).max(65_535).default(3000),
    CORS_ALLOWED_ORIGINS: zod
      .string()
      .default('')
      .transform((configuredOrigins) =>
        configuredOrigins
          .split(',')
          .map((configuredOrigin) => configuredOrigin.trim())
          .filter((configuredOrigin) => configuredOrigin.length > 0),
      )
      .refine(
        (configuredOrigins) =>
          configuredOrigins.every((configuredOrigin) => {
            try {
              const parsedOrigin = new URL(configuredOrigin);

              return (
                ['http:', 'https:'].includes(parsedOrigin.protocol) &&
                parsedOrigin.origin === configuredOrigin
              );
            } catch {
              return false;
            }
          }),
        'CORS origins must be exact HTTP or HTTPS origins without paths.',
      ),
    API_TRUSTED_PROXY_CIDRS: zod
      .string()
      .default('')
      .transform((configuredCidrs) =>
        configuredCidrs
          .split(',')
          .map((configuredCidr) => configuredCidr.trim())
          .filter((configuredCidr) => configuredCidr.length > 0),
      )
      .refine(
        (configuredCidrs) => configuredCidrs.every(isIpAddressOrCidr),
        'Trusted proxies must be explicit IP addresses or non-catch-all CIDRs.',
      ),
    API_HTTPS_ENABLED: zod
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    API_RATE_LIMIT_MAX: zod.coerce.number().int().min(1).max(10_000).default(100),
    API_RATE_LIMIT_TIME_WINDOW_MS: zod.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(60_000),
    API_AUTH_RATE_LIMIT_MAX: zod.coerce.number().int().min(1).max(10_000).default(60),
    API_AUTHENTICATED_RATE_LIMIT_MAX: zod.coerce.number().int().min(1).max(100_000).default(300),
    BETTER_AUTH_RATE_LIMIT_ENABLED: zod
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    BETTER_AUTH_RATE_LIMIT_MAX: zod.coerce.number().int().min(1).max(10_000).default(100),
    BETTER_AUTH_RATE_LIMIT_WINDOW_SECONDS: zod.coerce.number().int().min(1).max(3_600).default(60),
    BETTER_AUTH_CREDENTIAL_RATE_LIMIT_MAX: zod.coerce.number().int().min(1).max(1_000).default(5),
    BETTER_AUTH_CREDENTIAL_RATE_LIMIT_WINDOW_SECONDS: zod.coerce
      .number()
      .int()
      .min(1)
      .max(3_600)
      .default(60),
    BETTER_AUTH_SECRET: zod.string().min(32).optional(),
    BETTER_AUTH_URL: exactHttpOriginSchema.optional(),
    WEB_ORIGIN: exactHttpOriginSchema.optional(),
    GOOGLE_CLIENT_ID: zod.string().default(''),
    GOOGLE_CLIENT_SECRET: zod.string().default(''),
    FMP_API_KEY: fmpApiKeySchema,
    FMP_BASE_URL: fmpBaseUrlSchema,
    DATABASE_URL: zod
      .url()
      .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
        message: 'DATABASE_URL must use the PostgreSQL protocol.',
      })
      .default(localDevelopmentDatabaseUrl),
    DATABASE_POOL_MAX: zod.coerce.number().int().min(1).max(100).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: zod.coerce.number().int().min(1).max(60_000).default(5_000),
    DATABASE_IDLE_TIMEOUT_MS: zod.coerce.number().int().min(1_000).max(600_000).default(30_000),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === 'production' &&
      environment.DATABASE_URL === localDevelopmentDatabaseUrl
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must be explicitly configured in production.',
      });
    }

    if (
      environment.NODE_ENV !== 'test' &&
      (!environment.BETTER_AUTH_SECRET || environment.BETTER_AUTH_SECRET === testOnlyAuthSecret)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET must be set to a non-test value outside tests.',
      });
    }

    if (environment.NODE_ENV === 'production') {
      if (!environment.FMP_BASE_URL.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['FMP_BASE_URL'],
          message: 'FMP_BASE_URL must use HTTPS in production.',
        });
      }

      if (!environment.BETTER_AUTH_URL) {
        context.addIssue({
          code: 'custom',
          path: ['BETTER_AUTH_URL'],
          message: 'BETTER_AUTH_URL must be explicitly configured in production.',
        });
      }

      if (!environment.WEB_ORIGIN) {
        context.addIssue({
          code: 'custom',
          path: ['WEB_ORIGIN'],
          message: 'WEB_ORIGIN must be explicitly configured in production.',
        });
      }
    }
  })
  .transform((environment) => ({
    ...environment,
    BETTER_AUTH_SECRET: environment.BETTER_AUTH_SECRET ?? testOnlyAuthSecret,
    BETTER_AUTH_URL: environment.BETTER_AUTH_URL ?? localBetterAuthUrl,
    WEB_ORIGIN: environment.WEB_ORIGIN ?? localWebOrigin,
  }));

export type ApiEnvironmentInput = zod.infer<typeof apiEnvironmentSchema>;

export const apiEnvironment: ApiEnvironmentInput = apiEnvironmentSchema.parse(process.env);

function isIpAddressOrCidr(configuredCidr: string): boolean {
  const cidrParts = configuredCidr.split('/');

  if (cidrParts.length > 2) {
    return false;
  }

  const [ipAddress, prefixLengthText] = cidrParts;

  if (ipAddress === undefined) {
    return false;
  }

  const ipVersion = isIP(ipAddress);

  if (ipVersion === 0) {
    return false;
  }

  if (prefixLengthText === undefined) {
    return true;
  }

  const prefixLength = Number(prefixLengthText);
  const maximumPrefixLength = ipVersion === 4 ? 32 : 128;

  return Number.isInteger(prefixLength) && prefixLength > 0 && prefixLength <= maximumPrefixLength;
}
