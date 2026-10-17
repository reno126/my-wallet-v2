import { WalletCards } from 'lucide-react';
import type { LoaderFunctionArgs } from 'react-router';
import { Link, redirect, useLoaderData, useNavigate, useNavigation } from 'react-router';

import { walletListQuerySchema } from '@my-wallets/contracts';
import { LoadError } from '@/components/shared/LoadError';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { type WalletList, walletsApi } from '@/lib/api/wallets';

import { walletFailureMessage } from '../_utils/walletFailureMessage';
import { walletDictionary } from '../walletDictionary';
import { WalletCard } from './_components/WalletCard';

type WalletListData =
  { status: 'ready'; walletList: WalletList } | { status: 'error'; message: string };

export async function walletListLoader({
  request,
}: LoaderFunctionArgs): Promise<WalletListData | Response> {
  const pageValues = new URL(request.url).searchParams.getAll('page');
  const query = walletListQuerySchema.safeParse(
    pageValues.length === 0 ? {} : { page: pageValues[0] },
  );
  if (pageValues.length > 1 || !query.success) return redirect('/wallets');
  const result = await walletsApi.list(query.data, request.signal);
  return result.ok
    ? { status: 'ready', walletList: result.value }
    : {
        status: 'error',
        message: walletFailureMessage(result.error, { failed: walletDictionary.page.loadFailed }),
      };
}

export function WalletListComponent() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const data = useLoaderData<typeof walletListLoader>();

  if (data.status === 'error') {
    return (
      <section
        aria-labelledby="wallets-title"
        className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      >
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight" id="wallets-title">
            {walletDictionary.page.title}
          </h1>
          <p className="text-muted-foreground">{walletDictionary.page.description}</p>
        </div>
        <LoadError message={data.message} retryLabel={walletDictionary.page.retry} />
      </section>
    );
  }

  const { walletList } = data;
  const isLoading = navigation.state === 'loading';

  function changePage(page: number) {
    void navigate(page === 1 ? '/wallets' : `?page=${page}`);
  }

  return (
    <section aria-labelledby="wallets-title" className="flex flex-col gap-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">
            {walletDictionary.page.eyebrow}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl" id="wallets-title">
            {walletDictionary.page.title}
          </h1>
          <p className="max-w-prose text-muted-foreground">{walletDictionary.page.description}</p>
        </div>
        <Button asChild>
          <Link to="/wallets/new">{walletDictionary.page.createButton}</Link>
        </Button>
      </header>

      <Card className="border-border/70 bg-card/60">
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle as="h2" className="text-base font-semibold">
              {walletDictionary.page.listTitle}
            </CardTitle>
            <CardDescription>
              {walletDictionary.page.count(walletList.pagination.totalCount)}
            </CardDescription>
          </div>
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {walletDictionary.wallet.reportingCurrency}: USD
          </span>
        </CardHeader>
        <CardContent aria-busy={isLoading}>
          {walletList.wallets.length === 0 ? (
            <Empty className="border border-dashed border-border bg-background/50 py-12 sm:py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WalletCards aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle aria-level={2} role="heading">
                  {walletDictionary.empty.title}
                </EmptyTitle>
                <EmptyDescription>{walletDictionary.empty.description}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <p className="text-xs text-muted-foreground">
                  {walletDictionary.create.currencyNote}
                </p>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {walletList.wallets.map((wallet) => (
                <WalletCard key={wallet.id} wallet={wallet} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {walletList.pagination.totalPages > 1 ? (
        <nav
          aria-label={walletDictionary.page.paginationLabel}
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {walletDictionary.page.pageStatus(
              walletList.pagination.page,
              walletList.pagination.totalPages,
            )}
          </p>
          <div className="flex gap-3">
            <Button
              disabled={isLoading || walletList.pagination.page <= 1}
              onClick={() => changePage(walletList.pagination.page - 1)}
              variant="outline"
            >
              {walletDictionary.page.previousPage}
            </Button>
            <Button
              disabled={isLoading || walletList.pagination.page >= walletList.pagination.totalPages}
              onClick={() => changePage(walletList.pagination.page + 1)}
              variant="outline"
            >
              {walletDictionary.page.nextPage}
            </Button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}
