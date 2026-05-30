export function isLocalPostgresDatabaseUrl(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.includes("localhost") || url.includes("127.0.0.1");
}
