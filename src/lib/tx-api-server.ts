import "server-only";

const CONSOLE_QUERY = "format=console";
const DEFAULT_TX_CLOUD_URL = "http://localhost:3201";

export function getTxApiBaseUrl(): string {
  return (process.env.TX_CLOUD_URL?.trim() || DEFAULT_TX_CLOUD_URL).replace(/\/+$/, "");
}

export function normalizeTxApiPath(path: string): string {
  const trimmed = path.trim();
  // Paths pass through as given: the Hono server registers a mix of /v1-prefixed
  // routes and legacy unprefixed ones (server/src/routes/review-list.ts).
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function txApiRequest(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const apiKey = process.env.TX_CLOUD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TX_CLOUD_API_KEY is not set");
  }

  const normalizedPath = normalizeTxApiPath(path);
  const separator = normalizedPath.includes("?") ? "&" : "?";
  const url = `${getTxApiBaseUrl()}${normalizedPath}${separator}${CONSOLE_QUERY}`;

  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${apiKey}`,
      "X-User-Id": userId,
    },
  });
}

export async function txApiJson<T>(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await txApiRequest(userId, path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `TX API request failed (${response.status})`);
  }
  return (await response.json()) as T;
}
