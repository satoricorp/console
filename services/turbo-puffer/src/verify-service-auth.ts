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

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}
