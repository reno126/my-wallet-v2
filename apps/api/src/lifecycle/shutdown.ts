import type { EventEmitter } from 'node:events';

interface ShutdownOptions {
  signals: Pick<EventEmitter, 'once' | 'removeListener'>;
  close: () => Promise<unknown>;
  onError: () => void;
}

export function registerShutdown(options: ShutdownOptions) {
  let closing: Promise<unknown> | undefined;
  const shutdown = () => {
    closing ??= options.close().catch(options.onError);
  };
  options.signals.once('SIGINT', shutdown);
  options.signals.once('SIGTERM', shutdown);
  return () => {
    options.signals.removeListener('SIGINT', shutdown);
    options.signals.removeListener('SIGTERM', shutdown);
  };
}
