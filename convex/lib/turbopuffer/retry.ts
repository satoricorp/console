export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseMs?: number; retryIf?: (error: unknown) => boolean },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseMs = opts?.baseMs ?? 500;
  const retryIf = opts?.retryIf ?? (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1 || !retryIf(error)) break;
      const delay = baseMs * 2 ** attempt + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
