import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData, useNavigation } from 'react-router';

import { WalletMetadata } from '@/components/shared/wallets/WalletMetadata';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createRequestClient } from '@/lib/api/createRequestClient';
import { createLedgerApi } from '@/lib/api/ledger';

import { requirePageData } from '../../_utils/requirePageData';
import { HoldingList } from '../_components/HoldingList';
import { LedgerSummary } from '../_components/LedgerSummary';
import { PriceRefreshPanel } from '../_components/PriceRefreshPanel';
import { TransactionHistory } from '../_components/TransactionHistory';
import { useWalletPricing } from '../_hooks/useWalletPricing';
import { ledgerPageOptions, loadHistory } from '../_utils/loadLedger';
import { loadWallet } from '../_utils/loadWallet';
import { walletDictionary as walletMsg } from '../walletDictionary';
import { DeleteWalletDialog } from './_components/DeleteWalletDialog';

export async function walletDetailLoader(args: LoaderFunctionArgs) {
  const client = createRequestClient(args.request.signal);
  const wallet = await loadWallet(args, client);
  const api = createLedgerApi(client);
  const [summary, history] = await Promise.all([
    api.holdings(wallet.id),
    loadHistory(api, args.request, wallet.id),
  ]);
  return { wallet, summary: requirePageData(summary, ledgerPageOptions), history };
}

export function WalletDetailComponent() {
  const { wallet, summary, history } = useLoaderData<typeof walletDetailLoader>();
  const navigation = useNavigation();
  const pricing = useWalletPricing(wallet.id);
  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="wallet-detail-title"
      aria-busy={navigation.state !== 'idle'}
    >
      <div>
        <Button asChild variant="outline">
          <Link to="/wallets">{walletMsg.detail.back}</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">{walletMsg.detail.title}</p>
          <CardTitle as="h1" id="wallet-detail-title" className="min-w-0 wrap-anywhere">
            {wallet.name}
          </CardTitle>
          {wallet.description ? (
            <CardDescription className="min-w-0 wrap-anywhere whitespace-pre-wrap">
              {wallet.description}
            </CardDescription>
          ) : null}
          <Badge variant="secondary">{wallet.reportingCurrency}</Badge>
        </CardHeader>
        <CardContent>
          <WalletMetadata
            wallet={wallet}
            createdLabel={walletMsg.wallet.created}
            updatedLabel={walletMsg.wallet.updated}
          />
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to={`/wallets/${wallet.id}/buy`}>{walletMsg.detail.buy}</Link>
          </Button>
          <DeleteWalletDialog key={wallet.id} wallet={wallet} />
        </CardFooter>
      </Card>
      <LedgerSummary summary={summary} />
      <PriceRefreshPanel pricing={pricing} />
      <HoldingList holdings={summary.holdings} valuations={pricing.valuation?.holdings} />
      <TransactionHistory history={history} />
    </section>
  );
}
