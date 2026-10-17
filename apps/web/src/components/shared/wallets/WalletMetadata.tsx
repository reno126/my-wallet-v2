import type { WalletSummary } from '@/lib/api/wallets';

import { formatWalletDate } from './_utils/formatWalletDate';

interface WalletMetadataProps {
  wallet: WalletSummary;
  createdLabel: string;
  updatedLabel: string;
}

export function WalletMetadata({ wallet, createdLabel, updatedLabel }: WalletMetadataProps) {
  return (
    <dl className="grid grid-cols-2 gap-4 border-t border-border/70 pt-4">
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-xs font-medium text-muted-foreground">{createdLabel}</dt>
        <dd className="text-sm">{formatWalletDate(wallet.createdAt)}</dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-xs font-medium text-muted-foreground">{updatedLabel}</dt>
        <dd className="text-sm">{formatWalletDate(wallet.updatedAt)}</dd>
      </div>
    </dl>
  );
}
