export const testAuthToken = "test-cloud-api-key";

export function installTestAuth(): void {
  process.env.GX_CLOUD_API_KEY = testAuthToken;
}

export function authHeaders(userId: string, orgId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${testAuthToken}`,
    "X-User-Id": userId,
  };
  if (orgId) {
    headers["X-Org-Id"] = orgId;
  }
  return headers;
}
