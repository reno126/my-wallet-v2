import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useActionData, useNavigation } from 'react-router';
import { toast } from 'sonner';
import { z as zod } from 'zod';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WalletSummary } from '@/lib/api/wallets';

import { walletDictionary as walletMsg } from '../../walletDictionary';
import type { deleteWalletAction } from '../deleteWalletAction';
import { DeleteWalletConfirmation } from './DeleteWalletConfirmation';

interface DeleteWalletDialogProps {
  wallet: WalletSummary;
}

export function DeleteWalletDialog({ wallet }: DeleteWalletDialogProps) {
  const [stage, setStage] = useState<'closed' | 'warning' | 'confirm'>('closed');
  const actionData = useActionData<typeof deleteWalletAction>();
  const navigation = useNavigation();
  const form = useForm<{ confirmationName: string }>({
    mode: 'onChange',
    resolver: zodResolver(
      zod.object({
        confirmationName: zod.literal(wallet.name, { error: walletMsg.delete.mismatch }),
      }),
    ),
    defaultValues: { confirmationName: '' },
  });
  const isPending = form.formState.isSubmitting || navigation.state !== 'idle';
  const { setError } = form;
  useEffect(() => {
    if (actionData?.error) setError('root', { type: 'server', message: actionData.error });
  }, [actionData, setError]);

  function changeOpen(open: boolean) {
    if (isPending) return;
    if (open) toast.dismiss();
    if (!open) form.reset();
    setStage(open ? 'warning' : 'closed');
  }

  return (
    <AlertDialog open={stage !== 'closed'} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={isPending}>
          {walletMsg.delete.open}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        key={stage}
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        {stage === 'confirm' ? (
          <DeleteWalletConfirmation wallet={wallet} form={form} isPending={isPending} />
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{walletMsg.delete.firstTitle}</AlertDialogTitle>
              <AlertDialogDescription>{walletMsg.delete.firstWarning}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{walletMsg.delete.cancel}</AlertDialogCancel>
              <Button type="button" onClick={() => setStage('confirm')}>
                {walletMsg.delete.continue}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
