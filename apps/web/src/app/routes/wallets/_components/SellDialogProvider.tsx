import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { useTransactionMutation } from '../_hooks/useTransactionMutation';

function useSaleController() {
  const mutation = useTransactionMutation();
  const [selectedSymbol, setSelectedSymbol] = useState<string>();
  const [open, setOpen] = useState(false);
  const { busy, unconfirmed, succeeded, reset } = mutation;

  const select = useCallback(
    (symbol: string) => {
      if (busy || (unconfirmed && selectedSymbol !== symbol)) {
        return;
      }
      if (!unconfirmed) {
        reset();
      }
      setSelectedSymbol(symbol);
      setOpen(true);
    },
    [busy, unconfirmed, selectedSymbol, reset],
  );

  const close = useCallback(() => {
    if (busy) {
      return;
    }
    setOpen(false);
    if (!unconfirmed) {
      setSelectedSymbol(undefined);
    }
  }, [busy, unconfirmed]);

  return useMemo(
    () => ({ selectedSymbol, open: open && !succeeded, mutation, select, close }),
    [selectedSymbol, open, succeeded, mutation, select, close],
  );
}

const SaleContext = createContext<ReturnType<typeof useSaleController> | undefined>(undefined);

interface SellDialogProviderProps {
  children: ReactNode;
}

export function SellDialogProvider({ children }: SellDialogProviderProps) {
  const sale = useSaleController();
  return <SaleContext value={sale}>{children}</SaleContext>;
}

export function useSaleDialog() {
  const sale = useContext(SaleContext);
  if (!sale) {
    throw new Error('Sale dialogs require a SellDialogProvider.');
  }
  return sale;
}
