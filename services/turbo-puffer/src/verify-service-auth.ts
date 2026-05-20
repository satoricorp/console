export function verifyServiceAuth(request: Request): Response | null {
  const secret = process.env.TURBO_PUFFER_SERVICE_SECRET;
  if (!secret) {
    return new Response("Service secret not configured", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}

export function verifyGithubWebhookSignature(
  payload: string,
  signature: string | null,
): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const key = new TextEncoder().encode(secret);
  const data = new TextEncoder().encode(payload);
  const expected = `sha256=${Bun.crypto.hash("sha256", data, "hex", key as unknown as CryptoKey)}`;

  // Bun.crypto.hash doesn't work that way - use crypto.subtle or manual hmac
  return timingSafeEqualHex(
    signature,
    `sha256=${createHmacSha256(secret, payload)}`,
  );
}

function createHmacSha256(secret: string, payload: string): string {
  const hmac = new Bun.CryptoHasher("sha256", secret);
  hmac.update(payload);
  return hmac.digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}
