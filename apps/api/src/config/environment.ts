import { isIP } from 'node:net';

import { z as zod } from 'zod';

export const apiEnvironmentSchema = zod.object({
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
});

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
