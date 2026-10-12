import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function WalletsRoute() {
  return (
    <section aria-labelledby="wallets-title" className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-3xl font-semibold tracking-tight" id="wallets-title">
            Wallets
          </CardTitle>
          <CardDescription>Your authenticated wallet area is ready.</CardDescription>
        </CardHeader>
      </Card>
    </section>
  );
}
