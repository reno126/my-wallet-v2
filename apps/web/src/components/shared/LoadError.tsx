import { useRevalidator } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface LoadErrorProps {
  message: string;
  retryLabel: string;
}

export function LoadError({ message, retryLabel }: LoadErrorProps) {
  const revalidator = useRevalidator();
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <p>{message}</p>
        <Button
          disabled={revalidator.state !== 'idle'}
          onClick={() => void revalidator.revalidate()}
          variant="outline"
        >
          {retryLabel}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
