import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

import { createWalletSchema, walletListQuerySchema } from '@my-wallets/contracts';
import { type WalletList, walletsApi } from '@/lib/api/wallets';

export type WalletsLoaderData =
  { status: 'ready'; walletList: WalletList } | { status: 'error'; page: number };

export type WalletsActionData =
  { status: 'created'; walletName: string } | { status: 'failed'; reason: 'invalid' | 'request' };

export async function walletsLoader({
  request,
}: LoaderFunctionArgs): Promise<WalletsLoaderData | Response> {
  const searchParams = new URL(request.url).searchParams;
  const pageValues = searchParams.getAll('page');
  const query = walletListQuerySchema.safeParse(
    pageValues.length === 0 ? {} : { page: pageValues[0] },
  );

  if (pageValues.length > 1 || !query.success) {
    return redirect('/wallets');
  }

  const result = await walletsApi.list(query.data);

  return result.ok
    ? { status: 'ready', walletList: result.value }
    : { status: 'error', page: query.data.page };
}

export async function walletsAction({ request }: ActionFunctionArgs): Promise<WalletsActionData> {
  let rawInput: unknown;

  try {
    rawInput = await request.json();
  } catch {
    return { status: 'failed', reason: 'invalid' };
  }

  const input = createWalletSchema.safeParse(rawInput);

  if (!input.success) {
    return { status: 'failed', reason: 'invalid' };
  }

  const result = await walletsApi.create(input.data);

  return result.ok
    ? { status: 'created', walletName: result.value.name }
    : { status: 'failed', reason: 'request' };
}
