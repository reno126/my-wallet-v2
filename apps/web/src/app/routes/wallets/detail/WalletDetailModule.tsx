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
import { LedgerSummary } from '../_components/LedgerSummary';
import { TransactionHistory } from '../_components/TransactionHistory';
import { WalletPricing } from '../_components/WalletPricing';
import { ledgerPageOptions, loadHistory } from '../_utils/loadLedger';
import { loadWallet } from '../_utils/loadWallet';
import { requireWalletId } from '../_utils/requireWalletId';
import { walletDictionary as walletMsg } from '../walletDictionary';
import { DeleteWalletDialog } from './_components/DeleteWalletDialog';

export async function walletDetailLoader(args: LoaderFunctionArgs) {
  const walletId = requireWalletId(args.params);
  const client = createRequestClient(args.request.signal);
  const api = createLedgerApi(client);
  const [wallet, summary, history] = await Promise.all([
    loadWallet(args, client),
    api.holdings(walletId),
    loadHistory(api, args.request, walletId),
  ]);
  return { wallet, summary: requirePageData(summary, ledgerPageOptions), history };
}

export function WalletDetailComponent() {
  const data = useLoaderData<typeof walletDetailLoader>();
  return <WalletDetailContent key={data.wallet.id} data={data} />;
}

interface WalletDetailContentProps {
  data: Awaited<ReturnType<typeof walletDetailLoader>>;
}

export function WalletDetailContent({ data }: WalletDetailContentProps) {
  const { wallet, summary, history } = data;
  const navigation = useNavigation();
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
      <WalletPricing walletId={wallet.id} holdings={summary.holdings} />
      <TransactionHistory history={history} />
    </section>
  );
}
