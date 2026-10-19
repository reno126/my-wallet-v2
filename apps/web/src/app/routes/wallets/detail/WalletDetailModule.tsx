import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData, useNavigation } from 'react-router';

import { walletIdParamsSchema } from '@my-wallets/contracts';
import { LoadError } from '@/components/shared/LoadError';
import { WalletMetadata } from '@/components/shared/wallets/WalletMetadata';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { walletsApi, type WalletSummary } from '@/lib/api/wallets';

import { walletFailureMessage } from '../_utils/walletFailureMessage';
import { walletDictionary as walletMsg } from '../walletDictionary';
import { DeleteWalletDialog } from './_components/DeleteWalletDialog';

type WalletDetailData =
  | { status: 'ready'; wallet: WalletSummary }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export async function walletDetailLoader({
  request,
  params,
}: LoaderFunctionArgs): Promise<WalletDetailData> {
  const parsed = walletIdParamsSchema.safeParse(params);
  if (!parsed.success) return { status: 'unavailable' };
  const { walletId } = parsed.data;
  const result = await walletsApi.read(walletId, request.signal);
  if (result.ok) return { status: 'ready', wallet: result.value };
  if (result.error.kind === 'http' && [403, 404].includes(result.error.status))
    return { status: 'unavailable' };
  return {
    status: 'error',
    message: walletFailureMessage(result.error, { failed: walletMsg.detail.loadFailed }),
  };
}

export function WalletDetailComponent() {
  const data = useLoaderData<typeof walletDetailLoader>();
  const navigation = useNavigation();
  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="wallet-detail-title"
      aria-busy={navigation.state !== 'idle'}
    >
      <div>
        <Button asChild variant="outline">
          <Link to="/wallets">{walletMsg.detail.back}</Link>
        </Button>
      </div>
      {data.status === 'ready' ? (
        <>
          <Card>
            <CardHeader>
              <p className="text-sm text-muted-foreground">{walletMsg.detail.title}</p>
              <CardTitle as="h1" id="wallet-detail-title" className="min-w-0 wrap-anywhere">
                {data.wallet.name}
              </CardTitle>
              {data.wallet.description ? (
                <CardDescription className="min-w-0 wrap-anywhere whitespace-pre-wrap">
                  {data.wallet.description}
                </CardDescription>
              ) : null}
              <Badge variant="secondary">{data.wallet.reportingCurrency}</Badge>
            </CardHeader>
            <CardContent>
              <WalletMetadata
                wallet={data.wallet}
                createdLabel={walletMsg.wallet.created}
                updatedLabel={walletMsg.wallet.updated}
              />
            </CardContent>
            <CardFooter className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to={`/wallets/${data.wallet.id}/buy`}>{walletMsg.detail.buy}</Link>
              </Button>
              <DeleteWalletDialog key={data.wallet.id} wallet={data.wallet} />
            </CardFooter>
          </Card>
        </>
      ) : (
        <>
          <h1 id="wallet-detail-title" className="text-3xl font-semibold">
            {data.status === 'unavailable' ? walletMsg.detail.unavailable : walletMsg.detail.title}
          </h1>
          {data.status === 'unavailable' ? (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>{walletMsg.detail.unavailableDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <LoadError message={data.message} retryLabel={walletMsg.page.retry} />
          )}
        </>
      )}
    </section>
  );
}
