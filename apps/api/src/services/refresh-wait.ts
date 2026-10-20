export async function waitUntilRefreshDeadline(
  deadline: Date,
  now: () => Date,
  signal: AbortSignal,
): Promise<boolean> {
  // Recheck the wall clock after waking; cancellation releases timers and listeners on shutdown.
  while (!signal.aborted && now() < deadline) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, Math.max(1, deadline.getTime() - now().getTime()));
      timer.unref();
      signal.addEventListener('abort', finish, { once: true });
      function finish() {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      }
      if (signal.aborted) {
        finish();
      }
    });
  }
  return !signal.aborted;
}
