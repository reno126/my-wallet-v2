import type { FastifyRequest } from 'fastify';

export function getAuthenticatedUserId(request: FastifyRequest): string {
  const userId = request.authSession?.user.id;

  if (userId === undefined) {
    throw new Error('Authenticated route reached without a session.');
  }

  return userId;
}
