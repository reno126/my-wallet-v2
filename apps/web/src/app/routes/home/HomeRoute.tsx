import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function HomeRoute() {
  return (
    <section aria-labelledby="page-title" className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <p className="text-sm font-medium text-muted-foreground">Personal investment tracking</p>
          <CardTitle as="h1" className="text-3xl font-semibold tracking-tight" id="page-title">
            My Wallet
          </CardTitle>
          <CardDescription className="max-w-prose text-base">
            The application scaffold is ready. Wallet features will be added in later delivery
            slices.
          </CardDescription>
        </CardHeader>
      </Card>
    </section>
  );
}
