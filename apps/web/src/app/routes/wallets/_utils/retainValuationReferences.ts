import type { WalletValuation } from '@/lib/api/marketData';

export function retainValuationReferences(
  previous: WalletValuation | undefined,
  next: WalletValuation | undefined,
) {
  if (previous === next || JSON.stringify(previous) === JSON.stringify(next)) {
    return previous;
  }
  return next;
}
