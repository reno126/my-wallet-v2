import type { LoaderFunctionArgs } from 'react-router';

import {
  instrumentPriceParamsSchema,
  instrumentPriceQuerySchema,
  instrumentSearchQuerySchema,
} from '@my-wallets/contracts';
import { createRequestClient } from '@/lib/api/createRequestClient';
import { createPurchasesApi } from '@/lib/api/purchases';

import { purchaseFailureMessage } from './_utils/purchaseFailureMessage';
import { marketToday } from './_utils/purchaseForm';
import { purchaseDictionary as text } from './purchaseDictionary';

export async function instrumentSearchLoader({ request }: LoaderFunctionArgs) {
  const query = instrumentSearchQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return { status: 'error' as const, message: text.errors.search };
  }
  const client = createRequestClient(request.signal);
  const purchases = createPurchasesApi(client);
  const result = await purchases.search(query.data);
  return result.ok
    ? { status: 'ready' as const, query: query.data, ...result.value }
    : { status: 'error' as const, message: purchaseFailureMessage(result.error, 'search') };
}

export async function purchasePriceLoader({ request }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const symbol = instrumentPriceParamsSchema.safeParse({ symbol: query.get('symbol') });
  const date = instrumentPriceQuerySchema.safeParse({ date: query.get('date') });
  if (!symbol.success || !date.success || date.data.date > marketToday()) {
    return { status: 'error' as const, message: text.invalidDate };
  }
  const client = createRequestClient(request.signal);
  const purchases = createPurchasesApi(client);
  const result = await purchases.price(symbol.data.symbol, date.data.date);
  if (!result.ok) {
    return {
      status: 'error' as const,
      symbol: symbol.data.symbol,
      date: date.data.date,
      message: purchaseFailureMessage(result.error, 'price'),
    };
  }
  const usedPreviousTradingDay = result.value.effectiveDate < date.data.date;
  if (
    result.value.symbol !== symbol.data.symbol ||
    result.value.requestedDate !== date.data.date ||
    result.value.effectiveDate > date.data.date ||
    result.value.usedPreviousTradingDay !== usedPreviousTradingDay
  ) {
    return {
      status: 'error' as const,
      symbol: symbol.data.symbol,
      date: date.data.date,
      message: text.errors.price,
    };
  }
  return { status: 'ready' as const, price: result.value };
}
