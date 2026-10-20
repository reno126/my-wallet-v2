import { useRevalidator } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { ledgerDictionary as text } from '../ledgerDictionary';

interface MutationFailureProps {
  message: string;
  onRefreshed: () => void;
}

export function MutationFailure({ message, onRefreshed }: MutationFailureProps) {
  const revalidator = useRevalidator();
  async function refresh() {
    await revalidator.revalidate();
    onRefreshed();
  }
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col gap-3">
        <p>{message}</p>
        <Button
          type="button"
          variant="outline"
          disabled={revalidator.state !== 'idle'}
          onClick={() => void refresh()}
        >
          {revalidator.state === 'idle' ? text.refresh : text.refreshing}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
