import { Link } from 'react-router';

export function NotFoundRoute() {
  return (
    <section aria-labelledby="not-found-title" className="space-y-4">
      <h1 className="text-2xl font-semibold" id="not-found-title">
        Page not found
      </h1>
      <p className="text-slate-700">The address does not match an application route.</p>
      <Link className="font-medium text-blue-700 underline" to="/">
        Return to the home page
      </Link>
    </section>
  );
}
