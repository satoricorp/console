import "server-only";

const CONSOLE_QUERY = "format=console";

export function getGxApiBaseUrl(): string {
  return process.env.GX_CLOUD_API_URL?.replace(/\/$/, "") ?? "http://localhost:3200";
}

export async function gxApiRequest(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const apiKey = process.env.GX_CLOUD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GX_CLOUD_API_KEY is not set");
  }

  const separator = path.includes("?") ? "&" : "?";
  const url = `${getGxApiBaseUrl()}${path}${separator}${CONSOLE_QUERY}`;

  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${apiKey}`,
      "X-User-Id": userId,
    },
  });
}

export async function gxApiJson<T>(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await gxApiRequest(userId, path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `GX API request failed (${response.status})`);
  }
  return (await response.json()) as T;
}
