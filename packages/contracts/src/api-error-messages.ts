export const apiErrorMessages = {
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current resource state.',
  VALIDATION_FAILED: 'The request is invalid.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'The request content type is not supported.',
  RATE_LIMITED: 'Request rate limit exceeded. Try again later.',
  PROVIDER_UNAVAILABLE:
    'Market data is unavailable because the provider or shared request budget is not configured.',
  PROVIDER_QUOTA_EXHAUSTED:
    'The shared market-data request budget is exhausted. Try again after it resets.',
  PROVIDER_ERROR: 'The market-data provider could not return valid results. Try again later.',
  PROVIDER_TIMEOUT: 'The market-data provider did not respond in time. Try again later.',
  INTERNAL_SERVER_ERROR: 'An unexpected error occurred.',
};
