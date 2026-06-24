const defaultOpenAIBaseURL = "https://api.openai.com/v1";
const turboPufferBaseURL = "https://gcp-us-central1.turbopuffer.com";

export const openAIEmbeddingModel = "text-embedding-3-small";
export const embeddingDimensions = 512;

export type IndexingConfig = {
  openAIAPIKey: string;
  turboPufferAPIKey: string;
  openAIBaseURL: string;
  turboPufferBaseURL: string;
};

export function indexingConfig(): IndexingConfig | null {
  const openAIAPIKey =
    process.env.GX_EMBEDDING_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  const turboPufferAPIKey = process.env.TURBOPUFFER_API_KEY?.trim() || "";
  if (!openAIAPIKey || !turboPufferAPIKey) {
    return null;
  }
  const openAIBaseURL = (
    process.env.GX_OPENAI_BASE_URL?.trim() || defaultOpenAIBaseURL
  ).replace(/\/+$/, "");
  return {
    openAIAPIKey,
    turboPufferAPIKey,
    openAIBaseURL: openAIBaseURL.endsWith("/v1")
      ? openAIBaseURL
      : `${openAIBaseURL}/v1`,
    turboPufferBaseURL: turboPufferBaseURL.replace(/\/+$/, ""),
  };
}

export function namespaceForOrgRepo(orgId: string, repoFullName: string): string {
  const slug = repoFullName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return `gx-${orgId}-${slug}`;
}
