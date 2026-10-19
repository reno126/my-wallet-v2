import { type ApiErrorInput, apiErrorMessages } from '@my-wallets/contracts';

export type ApiFailure =
  | { code: 'UNAUTHENTICATED' }
  | { code: 'FORBIDDEN' }
  | { code: 'NOT_FOUND' }
  | { code: 'CONFLICT' }
  | { code: 'VALIDATION_FAILED' }
  | { code: 'PAYLOAD_TOO_LARGE' }
  | { code: 'UNSUPPORTED_MEDIA_TYPE' }
  | { code: 'RATE_LIMITED' }
  | {
      code:
        'PROVIDER_UNAVAILABLE' | 'PROVIDER_QUOTA_EXHAUSTED' | 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT';
    };

interface FailureResponse {
  statusCode: number;
  body: ApiErrorInput;
}

const publicFailureDetails: Record<ApiFailure['code'], { statusCode: number; message: string }> = {
  UNAUTHENTICATED: { statusCode: 401, message: apiErrorMessages.UNAUTHENTICATED },
  FORBIDDEN: { statusCode: 403, message: apiErrorMessages.FORBIDDEN },
  NOT_FOUND: { statusCode: 404, message: apiErrorMessages.NOT_FOUND },
  CONFLICT: { statusCode: 409, message: apiErrorMessages.CONFLICT },
  VALIDATION_FAILED: { statusCode: 400, message: apiErrorMessages.VALIDATION_FAILED },
  PAYLOAD_TOO_LARGE: { statusCode: 413, message: apiErrorMessages.PAYLOAD_TOO_LARGE },
  UNSUPPORTED_MEDIA_TYPE: { statusCode: 415, message: apiErrorMessages.UNSUPPORTED_MEDIA_TYPE },
  RATE_LIMITED: { statusCode: 429, message: apiErrorMessages.RATE_LIMITED },
  PROVIDER_UNAVAILABLE: { statusCode: 503, message: apiErrorMessages.PROVIDER_UNAVAILABLE },
  PROVIDER_QUOTA_EXHAUSTED: { statusCode: 503, message: apiErrorMessages.PROVIDER_QUOTA_EXHAUSTED },
  PROVIDER_ERROR: { statusCode: 502, message: apiErrorMessages.PROVIDER_ERROR },
  PROVIDER_TIMEOUT: { statusCode: 504, message: apiErrorMessages.PROVIDER_TIMEOUT },
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
