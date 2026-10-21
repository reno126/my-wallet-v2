import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData, useNavigation } from 'react-router';

import { holdingParamsSchema } from '@my-wallets/contracts';
import { Button } from '@/components/ui/button';
import { createRequestClient } from '@/lib/api/createRequestClient';
import { createLedgerApi } from '@/lib/api/ledger';

import { pageFailureResponse } from '../../_utils/pageFailure';
import { requirePageData } from '../../_utils/requirePageData';
import { LedgerSummary } from '../_components/LedgerSummary';
import { PriceRefreshPanel } from '../_components/PriceRefreshPanel';
import { SellDialog } from '../_components/SellDialog';
import { TransactionHistory } from '../_components/TransactionHistory';
import { useWalletPricing } from '../_hooks/useWalletPricing';
import { ledgerPageOptions, loadHistory } from '../_utils/loadLedger';
import { loadWallet } from '../_utils/loadWallet';
import { ledgerDictionary as text } from '../ledgerDictionary';

export async function instrumentDetailLoader(args: LoaderFunctionArgs) {
  const parsed = holdingParamsSchema.safeParse(args.params);
  if (!parsed.success) {
    throw pageFailureResponse(404, { title: text.unavailable, message: text.unavailable });
  }
  const { walletId, symbol } = parsed.data;
  const client = createRequestClient(args.request.signal);
  const api = createLedgerApi(client);
  const [wallet, holdingResult, history] = await Promise.all([
    loadWallet(args, client),
    api.holding(walletId, symbol),
    loadHistory(api, args.request, walletId, symbol),
  ]);
  return { wallet, holding: requirePageData(holdingResult, ledgerPageOptions), history };
}

export function InstrumentDetailComponent() {
  const { wallet, holding, history } = useLoaderData<typeof instrumentDetailLoader>();
  const navigation = useNavigation();
  const pricing = useWalletPricing(wallet.id);
  return (
    <section
      className="flex min-w-0 flex-col gap-6"
      aria-labelledby="instrument-title"
      aria-busy={navigation.state !== 'idle'}
    >
      <div>
        <Button asChild variant="outline">
          <Link to={`/wallets/${wallet.id}`}>{text.back}</Link>
        </Button>
      </div>
      <header className="flex min-w-0 flex-col gap-3">
        <h1 id="instrument-title" className="text-3xl font-semibold wrap-anywhere">
          {holding.symbol} · {holding.name}
        </h1>
        <p className="wrap-anywhere text-muted-foreground">
          {wallet.name} · {holding.exchange} · {holding.quoteCurrency}
        </p>
        <div className="flex flex-wrap gap-3">
          <SellDialog key={`${holding.walletId}:${holding.symbol}`} holding={holding} />
          <Button asChild variant="outline">
            <Link to={`/wallets/${wallet.id}/buy`}>{text.buy}</Link>
          </Button>
        </div>
      </header>
      <LedgerSummary summary={holding} />
      <PriceRefreshPanel pricing={pricing} symbol={holding.symbol} />
      <TransactionHistory history={history} instrumentView />
    </section>
  );
}
