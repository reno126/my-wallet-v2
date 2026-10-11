import { createAuthClient } from 'better-auth/react';

const apiOrigin = import.meta.env.VITE_API_BASE_URL;

export const authClient = createAuthClient({
  ...(apiOrigin ? { baseURL: apiOrigin } : {}),
  fetchOptions: {
    credentials: 'include',
  },
});
