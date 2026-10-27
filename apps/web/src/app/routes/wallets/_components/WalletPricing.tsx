import { memo } from 'react';

import type { Holding } from '@/lib/api/ledger';

import { useWalletPricing } from '../_hooks/useWalletPricing';
import { HoldingList } from './HoldingList';
import { PriceRefreshPanel } from './PriceRefreshPanel';

const PricedHoldings = memo(HoldingList);

interface WalletPricingProps {
  walletId: string;
  holdings: Holding[];
}

export function WalletPricing({ walletId, holdings }: WalletPricingProps) {
  const pricing = useWalletPricing(walletId);
  return (
    <>
      <PriceRefreshPanel pricing={pricing} />
      <PricedHoldings holdings={holdings} valuations={pricing.valuation?.holdings} />
    </>
  );
}

interface InstrumentPricingProps {
  walletId: string;
  symbol: string;
}

export function InstrumentPricing({ walletId, symbol }: InstrumentPricingProps) {
  const pricing = useWalletPricing(walletId);
  return <PriceRefreshPanel pricing={pricing} symbol={symbol} />;
}
