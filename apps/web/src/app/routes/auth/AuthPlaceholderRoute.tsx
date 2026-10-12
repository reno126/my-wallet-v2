import { Link, useLocation } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AuthPlaceholderRoute() {
  const { pathname } = useLocation();
  const pageTitle = pathname === '/register' ? 'Create an account' : 'Sign in';

  return (
    <section aria-labelledby="auth-title" className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-3xl font-semibold tracking-tight" id="auth-title">
            {pageTitle}
          </CardTitle>
          <CardDescription>Account access will be available here.</CardDescription>
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
