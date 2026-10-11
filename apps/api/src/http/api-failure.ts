import type { ApiErrorInput } from '@my-wallets/contracts';

export type ApiFailure =
  | { code: 'UNAUTHENTICATED' }
  | { code: 'FORBIDDEN' }
  | { code: 'NOT_FOUND' }
  | { code: 'CONFLICT' }
  | { code: 'VALIDATION_FAILED' };

interface FailureResponse {
  statusCode: number;
  body: ApiErrorInput;
}

const publicFailureDetails: Record<ApiFailure['code'], { statusCode: number; message: string }> = {
  UNAUTHENTICATED: { statusCode: 401, message: 'Authentication is required.' },
  FORBIDDEN: { statusCode: 403, message: 'You do not have permission to perform this action.' },
  NOT_FOUND: { statusCode: 404, message: 'The requested resource was not found.' },
  CONFLICT: { statusCode: 409, message: 'The request conflicts with the current resource state.' },
  VALIDATION_FAILED: { statusCode: 400, message: 'The request is invalid.' },
};

export function mapFailureToResponse(failure: ApiFailure, requestId: string): FailureResponse {
  const publicDetails = publicFailureDetails[failure.code];

  return {
    statusCode: publicDetails.statusCode,
    body: {
      error: {
        code: failure.code,
        message: publicDetails.message,
        requestId,
      },
    },
  };
}
