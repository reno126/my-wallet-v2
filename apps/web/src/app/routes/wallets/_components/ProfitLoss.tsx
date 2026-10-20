import { formatUsd } from '@/lib/formatFinancial';

import { ledgerDictionary as text } from '../ledgerDictionary';

interface ProfitLossProps {
  value: string;
}

export function ProfitLoss({ value }: ProfitLossProps) {
  const negative = value.startsWith('-');
  const zero = /^-?0(?:\.0+)?$/u.test(value);
  return (
    <span className={zero ? '' : negative ? 'text-destructive' : 'text-primary'}>
      {zero ? text.unchanged : negative ? text.loss : text.gain}: {formatUsd(value)}
    </span>
  );
}
