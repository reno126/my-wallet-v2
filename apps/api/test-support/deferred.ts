export function deferred<Value>() {
  let resolve: (value: Value) => void = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
