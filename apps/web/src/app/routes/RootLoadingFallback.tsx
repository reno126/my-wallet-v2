import { Skeleton } from '@/components/ui/skeleton';

export function RootLoadingFallback() {
  return (
    <div aria-live="polite" className="flex max-w-sm flex-col gap-3" role="status">
      <span className="sr-only">Checking your session</span>
      <Skeleton aria-hidden="true" className="h-6 w-40" />
      <Skeleton aria-hidden="true" className="h-4 w-64" />
    </div>
  );
}
