import { z as zod } from 'zod';

export const pageFailureSchema = zod.object({
  kind: zod.literal('page-load-failure'),
  title: zod.string().min(1),
  message: zod.string().min(1),
  retryAt: zod.number().finite().nonnegative().optional(),
});

export interface PageFailureContent {
  title: string;
  message: string;
  retryAt?: number;
}

export function pageFailureResponse(status: number, content: PageFailureContent): Response {
  return Response.json({ kind: 'page-load-failure', ...content }, { status });
}
