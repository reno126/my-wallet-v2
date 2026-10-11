import { Link, useLocation } from 'react-router';

export function AuthPlaceholderRoute() {
  const { pathname } = useLocation();
  const pageTitle = pathname === '/register' ? 'Create an account' : 'Sign in';

  return (
    <section aria-labelledby="auth-title" className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight" id="auth-title">
        {pageTitle}
      </h1>
      <p className="text-slate-700">Account access will be available here.</p>
      <Link className="text-blue-700 underline underline-offset-4" to="/">
        Return to the home page
      </Link>
    </section>
  );
}
