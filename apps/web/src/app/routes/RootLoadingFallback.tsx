export function RootLoadingFallback() {
  return (
    <p aria-live="polite" className="text-slate-700" role="status">
      Checking your session
    </p>
  );
}
