import type { ActionFunctionArgs } from 'react-router';
import { data, redirect } from 'react-router';
import { toast } from 'sonner';
import { z as zod } from 'zod';

import { resourceIdSchema, walletIdParamsSchema } from '@my-wallets/contracts';
import { createRequestClient } from '@/lib/api/createRequestClient';
import type { ApiFailure } from '@/lib/api/requestApiResult';
import { createTransactionsApi, sellTransactionSchema } from '@/lib/api/transactions';
import { marketToday } from '@/lib/marketDate';

import { ledgerDictionary as text } from './ledgerDictionary';

const deletionSchema = zod.strictObject({
  transactionId: resourceIdSchema,
  returnToWallet: zod.boolean(),
});

type TransactionMutationResult = { ok: true } | { ok: false; error: string; unconfirmed: boolean };

export async function transactionAction({ request, params }: ActionFunctionArgs) {
  const wallet = walletIdParamsSchema.safeParse({ walletId: params['walletId'] });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    request.signal.throwIfAborted();
    return invalidTransactionResult();
  }
  if (!wallet.success) {
    return invalidTransactionResult();
  }
  const api = createTransactionsApi(createRequestClient(request.signal));
  if (request.method === 'POST') {
    const sale = sellTransactionSchema.safeParse(input);
    if (!sale.success || sale.data.transactionDate > marketToday()) {
      return invalidTransactionResult();
    }
    const result = await api.sell(wallet.data.walletId, sale.data);
    if (!result.ok) {
      return transactionFailure(result.error);
    }
    toast.success(text.sell.confirmed);
    return data<TransactionMutationResult>({ ok: true });
  }
  const deletion = deletionSchema.safeParse(input);
  if (request.method !== 'DELETE' || !deletion.success) {
    return invalidTransactionResult();
  }
  const result = await api.delete(wallet.data.walletId, deletion.data.transactionId);
  if (!result.ok) {
    return transactionFailure(result.error);
  }
  toast.success(text.delete.confirmed);
  return deletion.data.returnToWallet
    ? redirect(`/wallets/${wallet.data.walletId}`)
    : data<TransactionMutationResult>({ ok: true });
}

function invalidTransactionResult() {
  return data<TransactionMutationResult>(
    { ok: false, error: text.errors.invalid, unconfirmed: false },
    { status: 400 },
  );
}

function transactionFailure(error: ApiFailure) {
  let message: string = text.errors.failed;
  const unconfirmed = error.kind !== 'http' || error.status >= 500;
  if (unconfirmed) {
    message = text.errors.unconfirmed;
  } else if (error.kind === 'http') {
    if (error.status === 401) {
      throw redirect('/login');
    }
    if (error.code === 'INSUFFICIENT_HOLDING') {
      message = text.errors.insufficient;
    } else if (error.status === 409) {
      message = text.errors.conflict;
    } else if (error.status === 404) {
      message = text.errors.unavailable;
    } else if (error.status === 403) {
      message = text.errors.forbidden;
    } else if (error.status === 429) {
      message =
        error.retryAfterSeconds === undefined
          ? text.errors.limited
          : text.errors.retryAfter(error.retryAfterSeconds);
    }
  }
  return data<TransactionMutationResult>(
    { ok: false, error: message, unconfirmed },
    { status: error.kind === 'http' ? error.status : 502 },
  );
}
