import { Badge } from '@/components/ui/badge';
import type { HoldingValuation } from '@/lib/api/marketData';

import { pricingDictionary as text } from '../pricingDictionary';

interface PriceFreshnessProps {
  freshness: HoldingValuation['freshness'];
}

export function PriceFreshness({ freshness }: PriceFreshnessProps) {
  return (
    <Badge variant={freshness === 'fresh' ? 'default' : 'outline'}>
      {text.freshness[freshness]}
    </Badge>
  );
}
