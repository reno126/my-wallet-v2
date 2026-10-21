import { useEffect, useState } from 'react';
import { useRevalidator } from 'react-router';

import { appDictionary } from '@/app/appDictionary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface LoadErrorProps {
  message: string;
  retryLabel: string;
  retryAt?: number;
}

export function LoadError({ message, retryLabel, retryAt }: LoadErrorProps) {
  const revalidator = useRevalidator();
  const [now, setNow] = useState(Date.now);
  const remainingSeconds =
    retryAt === undefined ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    if (retryAt === undefined || retryAt <= Date.now()) {
      return;
    }
    const timer = globalThis.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= retryAt) {
        globalThis.clearInterval(timer);
      }
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [retryAt]);
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <p>{message}</p>
        <Button
          disabled={revalidator.state !== 'idle' || remainingSeconds > 0}
          onClick={() => void revalidator.revalidate()}
          variant="outline"
        >
          {remainingSeconds > 0 ? appDictionary.pageErrors.retryIn(remainingSeconds) : retryLabel}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
