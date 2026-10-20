import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { deferred } from '../../test-support/deferred.ts';
import { registerShutdown } from './shutdown.ts';

describe('when handling process shutdown signals', () => {
  it('should close once when both termination signals arrive and detach listeners', async () => {
    // Arrange
    const signals = new EventEmitter();
    const drained = deferred<void>();
    const close = vi.fn<() => Promise<void>>().mockReturnValue(drained.promise);
    const onError = vi.fn<() => void>();
    const unregister = registerShutdown({ signals, close, onError });

    // Act
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    drained.resolve();
    await drained.promise;
    unregister();

    // Assert
    expect(close).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });

  it('should observe a failed shutdown through the application error callback', async () => {
    // Arrange
    const signals = new EventEmitter();
    const close = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('close failed'));
    const onError = vi.fn<() => void>();
    const unregister = registerShutdown({ signals, close, onError });

    // Act
    signals.emit('SIGTERM');
    await Promise.resolve();
    unregister();

    // Assert
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
