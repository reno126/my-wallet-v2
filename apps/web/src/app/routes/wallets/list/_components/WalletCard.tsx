import { Link } from 'react-router';

import { WalletMetadata } from '@/components/shared/wallets/WalletMetadata';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WalletSummary } from '@/lib/api/wallets';

import { walletDictionary } from '../../walletDictionary';

interface WalletCardProps {
  wallet: WalletSummary;
}

export function WalletCard({ wallet }: WalletCardProps) {
  return (
    <Card className="h-full border-border/80 bg-card/90">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle as="h2" className="min-w-0 wrap-anywhere text-lg font-semibold">
            <Link
              to={`/wallets/${wallet.id}`}
              className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {wallet.name}
            </Link>
          </CardTitle>
          <Badge className="shrink-0" variant="secondary">
            {wallet.reportingCurrency}
          </Badge>
        </div>
        {wallet.description ? (
          <CardDescription className="min-h-10 min-w-0 wrap-anywhere whitespace-pre-wrap leading-relaxed">
            {wallet.description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <WalletMetadata
          wallet={wallet}
          createdLabel={walletDictionary.wallet.created}
          updatedLabel={walletDictionary.wallet.updated}
        />
      </CardContent>
    </Card>
  );
}
