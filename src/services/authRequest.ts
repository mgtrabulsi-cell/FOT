export function createAuthFetch(origin: string, fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/auth/v1/')) return fetcher(input, init);
    const controller = new AbortController();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => {
      console.error('GameWire account request timed out.');
      controller.abort(new DOMException('Account connection timed out. Please retry.', 'TimeoutError'));
    }, 15000);
    try {
      const response = await fetcher(input, { ...init, signal: controller.signal });
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body,
        { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

export async function withAuthDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The sign-in connection timed out. Reload the sign-in connection and try again. Your saved account data has not been deleted.')), 20000);
    })]);
  } finally { clearTimeout(timer); }
}
