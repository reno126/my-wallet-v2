import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import { toast } from 'sonner';

import type { HistoricalPrice, Instrument } from '@/lib/api/purchases';

import { purchaseFormSchema } from '../_utils/purchaseForm';
import type { purchasePriceLoader } from '../purchaseLookups';

export type PurchaseQuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; price: HistoricalPrice }
  | { status: 'error'; message: string };

interface PurchaseQuoteRequest {
  symbol: string;
  currency: Instrument['quoteCurrency'];
  transactionDate: string;
}

interface UsePurchaseQuoteOptions {
  walletId: string;
  symbol: string | undefined;
  currency: Instrument['quoteCurrency'] | undefined;
  transactionDate: string;
}

export function usePurchaseQuote({
  walletId,
  symbol,
  currency,
  transactionDate,
}: UsePurchaseQuoteOptions) {
  const fetcher = useFetcher<typeof purchasePriceLoader>();
  const isValidDate = purchaseFormSchema.shape.transactionDate.safeParse(transactionDate).success;
  let state: PurchaseQuoteState = { status: 'idle' };

  if (symbol && currency && isValidDate) {
    if (fetcher.state !== 'idle') {
      state = { status: 'loading' };
    } else if (
      fetcher.data?.status === 'ready' &&
      fetcher.data.price.symbol === symbol &&
      fetcher.data.price.requestedDate === transactionDate
    ) {
      state = { status: 'ready', price: fetcher.data.price };
    } else if (
      fetcher.data?.status === 'error' &&
      fetcher.data.symbol === symbol &&
      fetcher.data.date === transactionDate
    ) {
      state = { status: 'error', message: fetcher.data.message };
    }
  }

  const errorMessage = state.status === 'error' ? state.message : undefined;
  useEffect(() => {
    if (errorMessage) {
      toast.error(errorMessage);
    }
  }, [errorMessage]);

  function requestQuote(request: PurchaseQuoteRequest) {
    if (!purchaseFormSchema.shape.transactionDate.safeParse(request.transactionDate).success) {
      return;
    }
    void fetcher.load(
      `/wallets/${walletId}/buy/price?${new URLSearchParams({
        symbol: request.symbol,
        currency: request.currency,
        date: request.transactionDate,
      })}`,
    );
  }

  function retryQuote() {
    if (symbol && currency) {
      requestQuote({ symbol, currency, transactionDate });
    }
  }

  return { state, requestQuote, retryQuote };
}
