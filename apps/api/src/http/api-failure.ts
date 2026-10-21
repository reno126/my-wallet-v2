import { type ApiErrorInput, apiErrorMessages } from '@my-wallets/contracts';

export type ApiFailure =
  | { code: 'UNAUTHENTICATED' }
  | { code: 'FORBIDDEN' }
  | { code: 'NOT_FOUND' }
  | { code: 'CONFLICT' }
  | { code: 'INSUFFICIENT_HOLDING' }
  | { code: 'VALIDATION_FAILED' }
  | { code: 'PAYLOAD_TOO_LARGE' }
  | { code: 'UNSUPPORTED_MEDIA_TYPE' }
  | { code: 'RATE_LIMITED' }
  | {
      code:
        | 'UNSUPPORTED_CURRENCY'
        | 'UNSUPPORTED_INSTRUMENT'
        | 'CURRENCY_UNAVAILABLE'
        | 'CURRENCY_MISMATCH'
        | 'PRICE_NOT_AVAILABLE'
        | 'PRICE_LOOKUP_INCOMPLETE';
    }
  | {
      code:
        | 'PROVIDER_UNAVAILABLE'
        | 'PROVIDER_QUOTA_EXHAUSTED'
        | 'PROVIDER_ERROR'
        | 'PROVIDER_PAYMENT_REQUIRED'
        | 'PROVIDER_TIMEOUT';
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
  INSUFFICIENT_HOLDING: { statusCode: 409, message: apiErrorMessages.INSUFFICIENT_HOLDING },
  VALIDATION_FAILED: { statusCode: 400, message: apiErrorMessages.VALIDATION_FAILED },
  PAYLOAD_TOO_LARGE: { statusCode: 413, message: apiErrorMessages.PAYLOAD_TOO_LARGE },
  UNSUPPORTED_MEDIA_TYPE: { statusCode: 415, message: apiErrorMessages.UNSUPPORTED_MEDIA_TYPE },
  RATE_LIMITED: { statusCode: 429, message: apiErrorMessages.RATE_LIMITED },
  PROVIDER_UNAVAILABLE: { statusCode: 503, message: apiErrorMessages.PROVIDER_UNAVAILABLE },
  PROVIDER_QUOTA_EXHAUSTED: { statusCode: 503, message: apiErrorMessages.PROVIDER_QUOTA_EXHAUSTED },
  PROVIDER_ERROR: { statusCode: 502, message: apiErrorMessages.PROVIDER_ERROR },
  PROVIDER_PAYMENT_REQUIRED: {
    statusCode: 502,
    message: apiErrorMessages.PROVIDER_PAYMENT_REQUIRED,
  },
  PROVIDER_TIMEOUT: { statusCode: 504, message: apiErrorMessages.PROVIDER_TIMEOUT },
  UNSUPPORTED_CURRENCY: { statusCode: 422, message: apiErrorMessages.UNSUPPORTED_CURRENCY },
  UNSUPPORTED_INSTRUMENT: { statusCode: 422, message: apiErrorMessages.UNSUPPORTED_INSTRUMENT },
  CURRENCY_UNAVAILABLE: { statusCode: 422, message: apiErrorMessages.CURRENCY_UNAVAILABLE },
  CURRENCY_MISMATCH: { statusCode: 422, message: apiErrorMessages.CURRENCY_MISMATCH },
  PRICE_NOT_AVAILABLE: { statusCode: 404, message: apiErrorMessages.PRICE_NOT_AVAILABLE },
  PRICE_LOOKUP_INCOMPLETE: { statusCode: 503, message: apiErrorMessages.PRICE_LOOKUP_INCOMPLETE },
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
