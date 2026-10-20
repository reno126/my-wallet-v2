import { redirect } from 'react-router';

import { transactionListQuerySchema } from '@my-wallets/contracts';
import type { createLedgerApi } from '@/lib/api/ledger';

import { requirePageData } from '../../_utils/requirePageData';
import { ledgerDictionary as text } from '../ledgerDictionary';

export const ledgerPageOptions = {
  title: text.history,
  message: text.loadFailed,
  notFound: { title: text.unavailable, message: text.unavailable },
  hideForbidden: true,
};

export async function loadHistory(
  api: ReturnType<typeof createLedgerApi>,
  request: Request,
  walletId: string,
  symbol?: string,
) {
  const url = new URL(request.url);
  const pages = url.searchParams.getAll('page');
  const parsed = transactionListQuerySchema.safeParse({
    ...(pages[0] === undefined ? {} : { page: pages[0] }),
    ...(symbol === undefined ? {} : { symbol }),
  });
  if (!parsed.success || pages.length > 1) {
    url.searchParams.delete('page');
    throw redirect(url.pathname + url.search);
  }
  const history = requirePageData(await api.history(walletId, parsed.data), ledgerPageOptions);
  const lastPage = Math.max(1, history.pagination.totalPages);
  if (history.pagination.page > lastPage) {
    url.searchParams.set('page', String(lastPage));
    throw redirect(url.pathname + url.search);
  }
  return history;
}
