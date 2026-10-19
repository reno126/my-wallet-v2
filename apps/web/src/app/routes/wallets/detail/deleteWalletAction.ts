import type { ActionFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { toast } from 'sonner';
import { z as zod } from 'zod';

import { walletIdParamsSchema } from '@my-wallets/contracts';
import { walletsApi } from '@/lib/api/wallets';

import { walletFailureMessage } from '../_utils/walletFailureMessage';
import { walletDictionary as walletMsg } from '../walletDictionary';

const deleteWalletInputSchema = zod
  .object({
    confirmationName: zod.string().min(1).max(100),
  })
  .strict();

export async function deleteWalletAction({ request, params }: ActionFunctionArgs) {
  const parsedParams = walletIdParamsSchema.safeParse(params);
  if (request.method !== 'DELETE' || !parsedParams.success) {
    return { error: walletMsg.delete.invalid };
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    request.signal.throwIfAborted();
    return { error: walletMsg.delete.invalid };
  }
  const parsed = deleteWalletInputSchema.safeParse(input);
  if (!parsed.success) return { error: walletMsg.delete.invalid };

  const { walletId } = parsedParams.data;
  const currentWallet = await walletsApi.read(walletId, request.signal);
  if (!currentWallet.ok) {
    return {
      error: walletFailureMessage(currentWallet.error, { failed: walletMsg.delete.failed }),
    };
  }
  if (parsed.data.confirmationName !== currentWallet.value.name) {
    return { error: walletMsg.delete.invalid };
  }
  const result = await walletsApi.delete(walletId, request.signal);
  if (!result.ok) {
    return {
      error: walletFailureMessage(result.error, {
        failed: walletMsg.delete.failed,
        unconfirmed: walletMsg.delete.unconfirmed,
      }),
    };
  }
  toast.success(walletMsg.delete.confirmed);
  return redirect('/wallets');
}
