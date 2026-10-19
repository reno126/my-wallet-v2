import type { ActionFunctionArgs } from 'react-router';
import { data as routeData, Link, redirect, useLoaderData } from 'react-router';
import { toast } from 'sonner';

import { createBuyTransactionSchema, walletIdParamsSchema } from '@my-wallets/contracts';
import { LoadError } from '@/components/shared/LoadError';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { purchasesApi } from '@/lib/api/purchases';

import { walletDetailLoader } from '../detail/WalletDetailModule';
import { walletDictionary } from '../walletDictionary';
import { PurchaseForm } from './_components/PurchaseForm';
import {
  isUnconfirmedPurchaseFailure,
  purchaseFailureMessage,
} from './_utils/purchaseFailureMessage';
import { marketToday } from './_utils/purchaseForm';
import { purchaseDictionary as text } from './purchaseDictionary';

export const buyPurchaseLoader = walletDetailLoader;

export async function buyPurchaseAction({ request, params }: ActionFunctionArgs) {
  const wallet = walletIdParamsSchema.safeParse(params);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    request.signal.throwIfAborted();
    return routeData({ error: text.invalid, unconfirmed: false }, { status: 400 });
  }
  const parsed = createBuyTransactionSchema.safeParse(raw);
  if (!wallet.success || !parsed.success || parsed.data.transactionDate > marketToday()) {
    return routeData({ error: text.invalid, unconfirmed: false }, { status: 400 });
  }
  const result = await purchasesApi.buy(wallet.data.walletId, parsed.data, request.signal);
  if (!result.ok) {
    const error = purchaseFailureMessage(result.error, 'buy');
    toast.error(error);
    return routeData(
      { error, unconfirmed: isUnconfirmedPurchaseFailure(result.error) },
      {
        status: result.error.kind === 'http' ? result.error.status : 502,
      },
    );
  }
  toast.success(text.confirmed);
  return redirect(`/wallets/${wallet.data.walletId}`);
}

export function BuyPurchaseComponent() {
  const data = useLoaderData<typeof buyPurchaseLoader>();
  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-6"
      aria-labelledby="purchase-title"
    >
      <div>
        <Button asChild variant="outline">
          <Link to={data.status === 'ready' ? `/wallets/${data.wallet.id}` : '/wallets'}>
            {data.status === 'ready' ? text.back : walletDictionary.detail.back}
          </Link>
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 id="purchase-title" className="text-3xl font-semibold">
          {text.title}
        </h1>
        {data.status === 'ready' ? (
          <>
            <p className="font-medium wrap-anywhere">{data.wallet.name}</p>
            <p className="text-sm text-muted-foreground">{text.description}</p>
          </>
        ) : null}
      </div>
      {data.status === 'ready' ? (
        <PurchaseForm key={data.wallet.id} walletId={data.wallet.id} />
      ) : data.status === 'unavailable' ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>{walletDictionary.detail.unavailableDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <LoadError message={data.message} retryLabel={walletDictionary.page.retry} />
      )}
    </section>
  );
}
