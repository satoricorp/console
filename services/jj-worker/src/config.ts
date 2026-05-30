export type WorkerConfig = {
  port: number;
  databaseUrl: string;
  workspaceRoot: string;
  serviceApiKey: string;
  githubToken: string | null;
};

export function loadConfig(): WorkerConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const serviceApiKey = process.env.GX_CLOUD_API_KEY?.trim();
  if (!serviceApiKey) {
    throw new Error("GX_CLOUD_API_KEY is required");
  }

  const home = process.env.HOME ?? "/tmp";
  const workspaceRoot =
    process.env.JJ_WORKSPACE_ROOT?.trim() ??
    `${home}/.gx/jj-workspaces`;

  return {
    port: Number(process.env.PORT ?? 3210),
    databaseUrl,
    workspaceRoot,
    serviceApiKey,
    githubToken: process.env.GITHUB_TOKEN?.trim() ?? null,
  };
}
