const defaultOpenAIBaseURL = "https://api.openai.com/v1";
const turboPufferBaseURL = "https://gcp-us-central1.turbopuffer.com";

/**
 * Embedding model and width.
 *
 * 512 was a Matryoshka truncation of text-embedding-3-small requested at embed
 * time via the API's `dimensions` parameter. Both the model and the width were
 * chosen by measurement: the tx repository was indexed four ways (3883 chunks
 * each) and scored against a 16-query ground-truth set.
 *
 *   config                  vector r@10  vector MRR  hybrid r@25
 *   3-small @ 512 (old)           0.513       0.710        0.692
 *   3-small @ 1536 (native)       0.538       0.750        0.692
 *   3-large @ 1536                0.410       0.598        0.667
 *   3-large @ 3072 (native)       0.436       0.568        0.641
 *
 * Paired per query, 3-small@1536 ranks the first correct file higher than
 * 3-large@3072 on 8 of 16 queries and lower on 1. Widening from 512 to the
 * native 1536 costs nothing at review time: embedding latency does not vary
 * with width (the HTTP round trip dominates) and TurboPuffer ANN stays in the
 * low tens of milliseconds.
 *
 * These values must stay in lockstep with internal/semantic/config.go in the
 * tx CLI: both write into the same namespaces, and TurboPuffer rejects a
 * vector whose width differs from the namespace's.
 */
export const openAIEmbeddingModel = "text-embedding-3-small";
export const embeddingDimensions = 1536;

/**
 * Version of the namespace schema (field set, full-text configuration, vector
 * width). It is part of the namespace name because TurboPuffer fixes vector
 * dimensions and full-text settings per namespace: a schema change has to land
 * in a fresh namespace rather than be rejected by, or silently corrupt, an
 * existing one. Keep in sync with semantic.IndexSchemaVersion in the tx CLI.
 */
export const indexSchemaVersion = 2;

export type IndexingConfig = {
  openAIAPIKey: string;
  turboPufferAPIKey: string;
  openAIBaseURL: string;
  turboPufferBaseURL: string;
};

export function indexingConfig(): IndexingConfig | null {
  const openAIAPIKey = process.env.OPENAI_API_KEY?.trim() || "";
  const turboPufferAPIKey = process.env.TURBOPUFFER_API_KEY?.trim() || "";
  if (!openAIAPIKey || !turboPufferAPIKey) {
    return null;
  }
  const openAIBaseURL = (
    process.env.TX_OPENAI_BASE_URL?.trim() || defaultOpenAIBaseURL
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

/**
 * Namespace for one org's copy of one repository. The tx CLI computes the same
 * name (semantic.NamespaceForRepo), so CLI-indexed code and server-indexed
 * diffs land in one searchable namespace instead of two half-empty ones.
 */
export function namespaceForOrgRepo(orgId: string, repoFullName: string): string {
  return `gx-${orgId}-${namespaceSlug(repoFullName)}-v${indexSchemaVersion}`;
}

function namespaceSlug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
}

export function reviewKnowledgeNamespace(): string {
  return process.env.TX_REVIEW_KNOWLEDGE_NAMESPACE?.trim() || "gx-review-knowledge";
}

export type EmbeddingProfile = { model: string; dimensions: number };

/** Profile for the per-org-per-repo namespaces this codebase writes. */
export const primaryEmbeddingProfile: EmbeddingProfile = {
  model: openAIEmbeddingModel,
  dimensions: embeddingDimensions,
};

/**
 * The shared review-knowledge corpus is a separately built namespace that this
 * codebase only reads. It holds ~35k rows of 512-dimension vectors and is not
 * rebuilt by an embedding change here, so it must keep being queried at its own
 * width — TurboPuffer rejects an ANN query whose vector width differs from the
 * namespace's, and the caller would lose the whole bucket to an error handler.
 */
export const knowledgeEmbeddingProfile: EmbeddingProfile = {
  model: "text-embedding-3-small",
  dimensions: 512,
};

/** Which embedding profile a namespace's vectors were written with. */
export function embeddingProfileForNamespace(namespace?: string): EmbeddingProfile {
  if (namespace && namespace.trim() === reviewKnowledgeNamespace()) {
    return knowledgeEmbeddingProfile;
  }
  return primaryEmbeddingProfile;
}

export function contextBrokerEnabled(): boolean {
  const flag = process.env.TX_CONTEXT_BROKER?.trim();
  return flag === "1" || flag === "true";
}
