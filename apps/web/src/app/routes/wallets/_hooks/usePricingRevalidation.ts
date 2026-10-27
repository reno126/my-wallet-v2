import { useEffect, useEffectEvent, useRef } from 'react';

const wakeCheckIntervalMs = 30_000;

interface PricingRevalidationOptions {
  quotaDate: string | undefined;
  busy: boolean;
  revalidate: () => void;
}

export function usePricingRevalidation({
  quotaDate,
  busy,
  revalidate,
}: PricingRevalidationOptions) {
  const previousQuotaDate = useRef(quotaDate);
  const lastWakeCheck = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!quotaDate) {
      return;
    }
    if (!previousQuotaDate.current) {
      previousQuotaDate.current = quotaDate;
      return;
    }
    if (quotaDate !== previousQuotaDate.current && !busy) {
      previousQuotaDate.current = quotaDate;
      revalidate();
    }
  }, [quotaDate, busy, revalidate]);

  const checkOnReturn = useEffectEvent(() => {
    if (document.visibilityState === 'hidden' || busy) {
      return;
    }
    const now = Date.now();
    if (lastWakeCheck.current !== undefined && now - lastWakeCheck.current < wakeCheckIntervalMs) {
      return;
    }
    lastWakeCheck.current = now;
    revalidate();
  });

  useEffect(() => {
    const onReturn = () => checkOnReturn();
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, []);
}
