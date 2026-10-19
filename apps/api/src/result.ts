type SuccessResult<Value> = { ok: true; value: Value };
type FailureResult<Failure> = { ok: false; error: Failure };

export type Result<Value, Failure> = SuccessResult<Value> | FailureResult<Failure>;

export function success<Value>(value: Value): SuccessResult<Value> {
  return { ok: true, value };
}

export function failure<const Failure>(error: Failure): FailureResult<Failure> {
  return { ok: false, error };
}
