import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import type { Holding } from '@/lib/api/ledger';

import { ledgerDictionary as text } from '../ledgerDictionary';
import { SaleEditor } from './SaleEditor';
import { useSaleDialog } from './SellDialogProvider';

interface SellDialogProps {
  holding: Holding;
}

export function SellDialog({ holding }: SellDialogProps) {
  const { selectedSymbol, open, mutation, select, close } = useSaleDialog();
  const selected = selectedSymbol === holding.symbol;
  const blocked = mutation.busy || (mutation.unconfirmed && !selected);
  const closed = holding.quantity === '0' && !(selected && mutation.unconfirmed);
  return (
    <Dialog
      open={selected && open}
      onOpenChange={(next) => (next ? select(holding.symbol) : close())}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto min-h-12 max-w-full py-2 whitespace-normal wrap-anywhere"
          disabled={closed || blocked}
        >
          {text.sell.open(holding.symbol)}
        </Button>
      </DialogTrigger>
      {selected && (open || mutation.unconfirmed) ? (
        <SaleEditor holding={holding} mutation={mutation} onClose={close} />
      ) : null}
    </Dialog>
  );
}
