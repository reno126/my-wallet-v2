import type { z as zod } from 'zod';

import {
  instrumentSearchQuerySchema,
  type instrumentSearchResponseSchema,
} from '@my-wallets/contracts';

import type { ApiFailure } from '../http/api-failure.js';
import { mapProviderFailure } from '../http/provider-failure.ts';
import type { createFmpClient } from '../providers/fmp/client.js';
import {
  fmpProfileResponseSchema,
  type FmpSearchCandidate,
  fmpSearchResponseSchema,
} from '../providers/fmp/instruments.ts';
import type { Result } from '../result.js';

type SearchQuery = zod.infer<typeof instrumentSearchQuerySchema>;
type SearchResponse = zod.infer<typeof instrumentSearchResponseSchema>;
type Instrument = SearchResponse['results'][number];
type ExcludedInstrument = SearchResponse['excluded'][number];
type FmpClient = ReturnType<typeof createFmpClient>;

const searchCacheTtlMs = 60_000;
const searchCacheMaximumEntries = 100;
const searchResultLimit = 10;
const unsupportedExchanges = new Set(['CRYPTO', 'FOREX', 'COMMODITY', 'INDEX']);

export function createInstrumentSearchService(client: FmpClient, now: () => number = Date.now) {
  const cache = new Map<string, { response: SearchResponse; expiresAt: number }>();

  return { search };

  async function search(input: SearchQuery): Promise<Result<SearchResponse, ApiFailure>> {
    const query = instrumentSearchQuerySchema.safeParse(input);

    if (!query.success) {
      return { ok: false, error: { code: 'VALIDATION_FAILED' } };
    }

    const normalizedQuery = query.data.q.trim();
    const cacheKey = JSON.stringify([query.data.mode, normalizedQuery]);
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > now()) {
      return { ok: true, value: structuredClone(cached.response) };
    }

    cache.delete(cacheKey);
    const searchResult = await client.request({
      endpoint: query.data.mode === 'name' ? 'search-name' : 'search-symbol',
      parameters: { query: normalizedQuery, limit: String(searchResultLimit) },
      responseSchema: fmpSearchResponseSchema,
    });

    if (!searchResult.ok) {
      return { ok: false, error: mapProviderFailure(searchResult.error) };
    }

    const response: SearchResponse = { results: [], excluded: [] };
    const seenSymbols = new Set<string>();

    for (const candidate of searchResult.value.slice(0, searchResultLimit)) {
      if (seenSymbols.has(candidate.symbol)) {
        continue;
      }
      seenSymbols.add(candidate.symbol);

      const resolved = await resolveCandidate(client, candidate);

      if (!resolved.ok) {
        return resolved;
      }

      if ('reason' in resolved.value) {
        response.excluded.push(resolved.value);
      } else {
        response.results.push(resolved.value);
      }
    }

    if (cache.size >= searchCacheMaximumEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    cache.set(cacheKey, {
      response: structuredClone(response),
      expiresAt: now() + searchCacheTtlMs,
    });

    return { ok: true, value: response };
  }
}

async function resolveCandidate(
  client: FmpClient,
  candidate: FmpSearchCandidate,
): Promise<Result<Instrument | ExcludedInstrument, ApiFailure>> {
  const initialExclusion = getExclusionReason(candidate);
  if (initialExclusion) {
    return { ok: true, value: excludeCandidate(candidate, initialExclusion) };
  }

  let details = candidate;

  if (!candidate.name || !candidate.currency) {
    const profileResult = await client.request({
      endpoint: 'profile',
      parameters: { symbol: candidate.symbol },
      responseSchema: fmpProfileResponseSchema,
    });

    if (!profileResult.ok) {
      return { ok: false, error: mapProviderFailure(profileResult.error) };
    }

    const profile = profileResult.value[0];
    if (!profile) {
      return { ok: true, value: excludeCandidate(candidate, 'DETAILS_UNAVAILABLE') };
    }
    if (profile.symbol !== candidate.symbol) {
      return { ok: false, error: { code: 'PROVIDER_ERROR' } };
    }
    if (
      candidate.currency &&
      profile.currency &&
      candidate.currency.toUpperCase() !== profile.currency.toUpperCase()
    ) {
      return { ok: true, value: excludeCandidate(candidate, 'CURRENCY_MISMATCH') };
    }

    details = {
      ...candidate,
      name: candidate.name || profile.companyName,
      currency: candidate.currency || profile.currency,
      exchange: candidate.exchange || profile.exchange,
      isEtf: candidate.isEtf || profile.isEtf,
      isFund: candidate.isFund || profile.isFund,
    };
  }

  const exclusion = getExclusionReason(details);
  if (exclusion) {
    return { ok: true, value: excludeCandidate(details, exclusion) };
  }
  if (!details.name || details.currency?.toUpperCase() !== 'USD') {
    return { ok: true, value: excludeCandidate(details, 'DETAILS_UNAVAILABLE') };
  }

  return {
    ok: true,
    value: {
      symbol: details.symbol,
      name: details.name,
      quoteCurrency: 'USD',
      exchange: details.exchange || null,
    },
  };
}

function getExclusionReason(
  candidate: FmpSearchCandidate,
): ExcludedInstrument['reason'] | undefined {
  if (candidate.currency && candidate.currency.toUpperCase() !== 'USD') {
    return 'NON_USD';
  }
  if (
    candidate.isEtf ||
    candidate.isFund ||
    unsupportedExchanges.has(candidate.exchange?.toUpperCase() ?? '')
  ) {
    return 'UNSUPPORTED_INSTRUMENT';
  }
  return undefined;
}

function excludeCandidate(
  candidate: FmpSearchCandidate,
  reason: ExcludedInstrument['reason'],
): ExcludedInstrument {
  return {
    symbol: candidate.symbol,
    quoteCurrency: candidate.currency?.toUpperCase() || null,
    reason,
  };
}
