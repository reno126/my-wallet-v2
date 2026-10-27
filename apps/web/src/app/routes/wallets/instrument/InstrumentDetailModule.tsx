import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData, useNavigation } from 'react-router';

import { holdingParamsSchema } from '@my-wallets/contracts';
import { Button } from '@/components/ui/button';
import { createRequestClient } from '@/lib/api/createRequestClient';
import { createLedgerApi } from '@/lib/api/ledger';

import { pageFailureResponse } from '../../_utils/pageFailure';
import { requirePageData } from '../../_utils/requirePageData';
import { LedgerSummary } from '../_components/LedgerSummary';
import { SellDialog } from '../_components/SellDialog';
import { SellDialogProvider } from '../_components/SellDialogProvider';
import { TransactionHistory } from '../_components/TransactionHistory';
import { InstrumentPricing } from '../_components/WalletPricing';
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
  const data = useLoaderData<typeof instrumentDetailLoader>();
  return <InstrumentDetailContent key={data.wallet.id} data={data} />;
}

interface InstrumentDetailContentProps {
  data: Awaited<ReturnType<typeof instrumentDetailLoader>>;
}

export function InstrumentDetailContent({ data }: InstrumentDetailContentProps) {
  const { wallet, holding, history } = data;
  const navigation = useNavigation();
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
          <SellDialogProvider key={`${holding.walletId}:${holding.symbol}`}>
            <SellDialog holding={holding} />
          </SellDialogProvider>
          <Button asChild variant="outline">
            <Link to={`/wallets/${wallet.id}/buy`}>{text.buy}</Link>
          </Button>
        </div>
      </header>
      <LedgerSummary summary={holding} />
      <InstrumentPricing walletId={wallet.id} symbol={holding.symbol} />
      <TransactionHistory history={history} instrumentView />
    </section>
  );
}
