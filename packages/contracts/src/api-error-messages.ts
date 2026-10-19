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
  UNSUPPORTED_CURRENCY: 'Only USD-denominated instruments and prices are supported.',
  CURRENCY_UNAVAILABLE:
    'The provider did not identify the instrument quote currency. A USD price cannot be assumed.',
  CURRENCY_MISMATCH: 'The historical price currency does not match the instrument quote currency.',
  PRICE_NOT_AVAILABLE:
    'No historical closing price is available on or before the requested date in the instrument’s available history.',
  PRICE_LOOKUP_INCOMPLETE:
    'The historical lookup reached its request limit before earlier history could be checked.',
  INTERNAL_SERVER_ERROR: 'An unexpected error occurred.',
};
