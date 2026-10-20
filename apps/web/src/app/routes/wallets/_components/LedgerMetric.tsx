import type { ReactNode } from 'react';

interface LedgerMetricProps {
  label: string;
  children: ReactNode;
  exactValue?: string;
}

export function LedgerMetric({ label, children, exactValue }: LedgerMetricProps) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd title={exactValue} className="wrap-anywhere tabular-nums">
        {children}
      </dd>
    </div>
  );
}
