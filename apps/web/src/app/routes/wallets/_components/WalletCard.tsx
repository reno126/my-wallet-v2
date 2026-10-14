import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WalletSummary } from '@/lib/api/wallets';

import { formatWalletDate } from '../_utils/formatWalletDate';
import { walletDictionary } from '../_utils/walletDictionary';

interface WalletCardProps {
  wallet: WalletSummary;
}

export function WalletCard({ wallet }: WalletCardProps) {
  return (
    <Card className="h-full border-border/80 bg-card/90">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle as="h2" className="min-w-0 break-words text-lg font-semibold">
            {wallet.name}
          </CardTitle>
          <Badge className="shrink-0" variant="secondary">
            {wallet.reportingCurrency}
          </Badge>
        </div>
        {wallet.description ? (
          <CardDescription className="min-h-10 leading-relaxed">
            {wallet.description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 border-t border-border/70 pt-4">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              {walletDictionary.wallet.created}
            </dt>
            <dd className="text-sm">{formatWalletDate(wallet.createdAt)}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              {walletDictionary.wallet.updated}
            </dt>
            <dd className="text-sm">{formatWalletDate(wallet.updatedAt)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
