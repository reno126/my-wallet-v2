import { Outlet } from 'react-router';

export function RootLayout() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12 text-slate-950">
      <Outlet />
    </main>
  );
}
