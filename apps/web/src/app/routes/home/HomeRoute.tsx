import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function HomeRoute() {
  return (
    <section aria-labelledby="page-title" className="mx-auto w-full max-w-4xl">
      <Card>
        <CardContent className="grid gap-10 py-10 md:grid-cols-[1.2fr_0.8fr] md:items-center md:px-10 md:py-14">
          <div className="flex flex-col gap-5">
            <CardHeader className="gap-3 px-0">
              <p className="text-sm font-medium text-primary">Personal investment tracking</p>
              <CardTitle
                as="h1"
                className="text-4xl font-semibold tracking-tight md:text-5xl"
                id="page-title"
              >
                A clearer view of your investments.
              </CardTitle>
              <CardDescription className="max-w-prose text-base leading-relaxed">
                Keep your investment wallets organized and follow your portfolio activity in one
                place.
              </CardDescription>
            </CardHeader>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/register">Create your account</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          </div>
          <Card aria-label="My Wallet portfolio overview" className="bg-muted/40" role="group">
            <CardHeader>
              <CardDescription>Your investment workspace</CardDescription>
              <CardTitle as="h2" className="text-2xl">
                Built around your wallets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Track activity with a private account and return whenever you need an update.
              </p>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </section>
  );
}
