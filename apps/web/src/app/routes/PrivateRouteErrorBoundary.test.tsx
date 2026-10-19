import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appDictionary } from '../appDictionary';
import { AuthenticatedLayout } from '../layouts/AuthenticatedLayout';
import { pageFailureResponse } from './_utils/pageFailure';
import { PrivateRouteErrorBoundary } from './PrivateRouteErrorBoundary';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function HealthyPage() {
  return <h1>Loaded page</h1>;
}

function openRoute(route: RouteObject) {
  const router = createMemoryRouter(
    [
      {
        Component: AuthenticatedLayout,
        children: [
          {
            ErrorBoundary: PrivateRouteErrorBoundary,
            children: [{ path: '/wallets/test', ...route }],
          },
        ],
      },
    ],
    { initialEntries: ['/wallets/test'] },
  );
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

describe('when a private route fails', () => {
  it('should keep navigation available for an unavailable page without offering retry', async () => {
    // Arrange
    const text = appDictionary.pageErrors;
    // Act
    openRoute({
      loader: () => {
        throw pageFailureResponse(404, {
          title: text.unavailableTitle,
          message: text.unavailableMessage,
        });
      },
    });
    // Assert
    expect(await screen.findByRole('heading', { name: text.unavailableTitle })).toBeVisible();
    expect(screen.getByRole('navigation', { name: appDictionary.navigation.main })).toBeVisible();
    expect(screen.getByRole('button', { name: appDictionary.navigation.signOut })).toBeVisible();
    expect(screen.queryByRole('button', { name: text.retry })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: text.back })).toHaveAttribute('href', '/wallets');
  });

  it('should wait for Retry-After, then retry the loader without replaying an action', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    let reads = 0;
    let completeRetry = () => {};
    const retryGate = new Promise<void>((resolve) => {
      completeRetry = resolve;
    });
    const action = vi.fn();
    const text = appDictionary.pageErrors;
    const user = openRoute({
      Component: HealthyPage,
      action,
      loader: async () => {
        reads += 1;
        if (reads === 1)
          throw pageFailureResponse(429, {
            title: text.rateLimitedTitle,
            message: text.rateLimited,
            retryAt: Date.now() + 30_000,
          });
        await retryGate;
        return null;
      },
    });
    // Assert
    const blocked = await screen.findByRole('button', { name: text.retryIn(30) });
    expect(blocked).toBeDisabled();
    // Act
    await user.click(blocked);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    // Assert
    expect(screen.getByRole('button', { name: text.retryIn(1) })).toBeDisabled();
    expect(reads).toBe(1);
    // Act
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await user.click(screen.getByRole('button', { name: text.retry }));
    await waitFor(() => expect(reads).toBe(2));
    // Assert
    expect(screen.getByRole('button', { name: text.retry })).toBeDisabled();
    expect(action).not.toHaveBeenCalled();
    // Act
    await act(async () => {
      completeRetry();
      await retryGate;
    });
    // Assert
    expect(await screen.findByRole('heading', { name: 'Loaded page' })).toBeVisible();
    expect(reads).toBe(2);
  });

  it.each(['loader', 'render'])('should sanitize an unexpected %s exception', async (origin) => {
    // Arrange
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('Private diagnostic detail');
    // Act
    openRoute({
      loader: () => {
        if (origin === 'loader') throw failure;
        return null;
      },
      Component: function BrokenPage() {
        throw failure;
      },
    });
    // Assert
    expect(
      await screen.findByRole('heading', { name: appDictionary.pageErrors.unexpectedTitle }),
    ).toBeVisible();
    expect(screen.getByRole('navigation', { name: appDictionary.navigation.main })).toBeVisible();
    expect(screen.queryByText(failure.message)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: appDictionary.pageErrors.reload })).toBeEnabled();
  });

  it('should hide unrecognized response payloads', async () => {
    // Act
    openRoute({
      loader: () => {
        throw Response.json({ message: 'Private server detail' }, { status: 500 });
      },
    });
    // Assert
    expect(
      await screen.findByRole('heading', { name: appDictionary.pageErrors.unexpectedTitle }),
    ).toBeVisible();
    expect(screen.queryByText('Private server detail')).not.toBeInTheDocument();
  });
});
