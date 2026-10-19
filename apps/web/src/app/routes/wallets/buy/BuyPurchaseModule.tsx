import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { data as routeData, Link, redirect, useLoaderData } from 'react-router';
import { toast } from 'sonner';

import { createBuyTransactionSchema, walletIdParamsSchema } from '@my-wallets/contracts';
import { Button } from '@/components/ui/button';
import { purchasesApi } from '@/lib/api/purchases';

import { loadWallet } from '../_utils/loadWallet';
import { PurchaseForm } from './_components/PurchaseForm';
import {
  isUnconfirmedPurchaseFailure,
  purchaseFailureMessage,
} from './_utils/purchaseFailureMessage';
import { marketToday } from './_utils/purchaseForm';
import { purchaseDictionary as text } from './purchaseDictionary';

export async function buyPurchaseLoader(args: LoaderFunctionArgs) {
  return { wallet: await loadWallet(args) };
}

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
  const { wallet } = useLoaderData<typeof buyPurchaseLoader>();
  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-6"
      aria-labelledby="purchase-title"
    >
      <div>
        <Button asChild variant="outline">
          <Link to={`/wallets/${wallet.id}`}>{text.back}</Link>
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 id="purchase-title" className="text-3xl font-semibold">
          {text.title}
        </h1>
        <p className="font-medium wrap-anywhere">{wallet.name}</p>
        <p className="text-sm text-muted-foreground">{text.description}</p>
      </div>
      <PurchaseForm key={wallet.id} walletId={wallet.id} />
    </section>
  );
}
