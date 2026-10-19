export const appDictionary = {
  brand: 'My Wallet',
  pageErrors: {
    unavailableTitle: 'Page unavailable',
    unavailableMessage: 'This page does not exist or is not available to your account.',
    forbiddenTitle: 'Access denied',
    forbiddenMessage: 'Your account does not have access to this page.',
    unexpectedTitle: 'Something went wrong',
    unexpectedMessage:
      'An unexpected application error occurred. Reload the page or return to your wallets.',
    rateLimitedTitle: 'Too many requests',
    rateLimited: 'Too many requests. Please wait before trying again.',
    retryAfter: (seconds: number) => `Too many requests. Try again in ${seconds} seconds.`,
    retry: 'Try again',
    retryIn: (seconds: number) => `Try again in ${seconds}s`,
    reload: 'Reload page',
    back: 'Back to wallets',
  },
  navigation: {
    loading: 'Loading page…',
    main: 'Main navigation',
    wallets: 'Wallets',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    signOutFailed: 'We could not sign you out. Please try again.',
  },
} as const;
