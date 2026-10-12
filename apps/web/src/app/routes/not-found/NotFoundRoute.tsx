import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function NotFoundRoute() {
  return (
    <section aria-labelledby="not-found-title" className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-2xl font-semibold" id="not-found-title">
            Page not found
          </CardTitle>
          <CardDescription>The address does not match an application route.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" variant="link">
            <Link to="/">Return to the home page</Link>
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
