import { z as zod } from 'zod';

export const fmpApiKeySchema = zod.string().trim().max(512).default('');

export const fmpBaseUrlSchema = zod
  .url()
  .refine((value) => {
    try {
      const baseUrl = new URL(value);
      const isLocalHttp =
        baseUrl.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);

      return (
        (baseUrl.protocol === 'https:' || isLocalHttp) &&
        !baseUrl.username &&
        !baseUrl.password &&
        !baseUrl.search &&
        !baseUrl.hash
      );
    } catch {
      return false;
    }
  }, 'FMP_BASE_URL must use HTTPS (or loopback HTTP) without credentials, query, or fragment.')
  .default('https://financialmodelingprep.com/stable/')
  .transform((value) => `${new URL(value).href.replace(/\/+$/, '')}/`);
