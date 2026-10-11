export type Result<Value, Failure> = { ok: true; value: Value } | { ok: false; error: Failure };
