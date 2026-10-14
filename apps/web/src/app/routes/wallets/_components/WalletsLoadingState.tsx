import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { walletDictionary } from '../_utils/walletDictionary';

const walletCardPlaceholders = ['first', 'second', 'third'] as const;

export function WalletsLoadingState() {
  return (
    <section
      aria-label={walletDictionary.page.loading}
      className="flex flex-col gap-6"
      role="status"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {walletCardPlaceholders.map((placeholder) => (
          <Card key={placeholder}>
            <CardHeader className="gap-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-28" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
