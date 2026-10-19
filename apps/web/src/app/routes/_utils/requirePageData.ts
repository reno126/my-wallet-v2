import { redirect } from 'react-router';

import type { ApiResult } from '@/lib/api/requestApiResult';

import { appDictionary } from '../../appDictionary';
import { type PageFailureContent, pageFailureResponse } from './pageFailure';

interface PageReadOptions {
  title: string;
  message: string;
  notFound?: PageFailureContent;
  hideForbidden?: boolean;
}

export function requirePageData<Value>(result: ApiResult<Value>, options: PageReadOptions): Value {
  if (result.ok) return result.value;
  const error = result.error;
  const text = appDictionary.pageErrors;
  if (error.kind === 'http') {
    if (error.status === 401) throw redirect('/login');
    if (error.status === 404 || (error.status === 403 && options.hideForbidden)) {
      throw pageFailureResponse(
        404,
        options.notFound ?? {
          title: text.unavailableTitle,
          message: text.unavailableMessage,
        },
      );
    }
    if (error.status === 403) {
      throw pageFailureResponse(403, {
        title: text.forbiddenTitle,
        message: text.forbiddenMessage,
      });
    }
    if (error.status === 429) {
      const retryAt =
        error.retryAfterSeconds === undefined
          ? undefined
          : Math.min(Number.MAX_SAFE_INTEGER, Date.now() + error.retryAfterSeconds * 1000);
      throw pageFailureResponse(429, {
        title: text.rateLimitedTitle,
        message: text.rateLimited,
        ...(retryAt === undefined ? {} : { retryAt }),
      });
    }
  }
  const status = error.kind === 'http' ? error.status : error.kind === 'network' ? 503 : 502;
  throw pageFailureResponse(status, { title: options.title, message: options.message });
}
