import { Hono } from "hono";
import { getSql } from "../db";
import { upsertClientChunks } from "../indexing/turbopuffer";
import { requireAuth, type AppEnv } from "../middleware/auth";

export const indexRoutes = new Hono<AppEnv>();

export const ALLOWED_INDEX_SOURCE_KINDS = [
  "code_file",
  "session_transcript",
  "session_context",
  "review_policy",
] as const;

const ALLOWED_SOURCE_KINDS = new Set<string>(ALLOWED_INDEX_SOURCE_KINDS);

export const MAX_CHUNKS_PER_REQUEST = 64;
export const MAX_CHUNK_CHARS = 8_000;

export type IndexChunkInput = {
  text?: string;
  source_kind?: string;
  chunk_hash?: string;
  file?: string;
  attributes?: Record<string, unknown>;
};

export type PreparedIndexChunk = {
  text: string;
  sourceKind: string;
  chunkHash?: string;
  file?: string;
  attributes?: Record<string, unknown>;
};

/** Pure validation for /v1/index/chunks body chunks (testable without DB). */
export function prepareIndexChunks(
  rawChunks: IndexChunkInput[] | undefined,
): { ok: true; chunks: PreparedIndexChunk[] } | { ok: false; status: 400; error: string; allowed?: string[] } {
  if (!Array.isArray(rawChunks) || rawChunks.length === 0) {
    return { ok: false, status: 400, error: "chunks required" };
  }
  if (rawChunks.length > MAX_CHUNKS_PER_REQUEST) {
    return {
      ok: false,
      status: 400,
      error: `At most ${MAX_CHUNKS_PER_REQUEST} chunks per request`,
    };
  }

  const prepared: PreparedIndexChunk[] = [];
  for (const chunk of rawChunks) {
    const sourceKind = chunk.source_kind?.trim() ?? "";
    if (!ALLOWED_SOURCE_KINDS.has(sourceKind)) {
      return {
        ok: false,
        status: 400,
        error: `source_kind not allowed: ${sourceKind || "(missing)"}`,
        allowed: [...ALLOWED_SOURCE_KINDS],
      };
    }
    const text = typeof chunk.text === "string" ? chunk.text : "";
    if (!text.trim()) {
      return { ok: false, status: 400, error: "chunk text required" };
    }
    if (text.length > MAX_CHUNK_CHARS) {
      return {
        ok: false,
        status: 400,
        error: `chunk text exceeds ${MAX_CHUNK_CHARS} chars`,
      };
    }
    const attrs = { ...(chunk.attributes ?? {}) };
    delete attrs.org_id;
    prepared.push({
      text,
      sourceKind,
      chunkHash: chunk.chunk_hash,
      file: chunk.file,
      attributes: attrs,
    });
  }
  return { ok: true, chunks: prepared };
}

indexRoutes.use("/v1/index/*", requireAuth);

indexRoutes.post("/v1/index/chunks", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => null)) as {
    repo_full_name?: string;
    chunks?: IndexChunkInput[];
  } | null;

  const repoFullName = body?.repo_full_name?.trim() ?? "";
  if (!repoFullName || !repoFullName.includes("/")) {
    return c.json({ error: "repo_full_name is required" }, 400);
  }

  const prepared = prepareIndexChunks(body?.chunks);
  if (!prepared.ok) {
    return c.json(
      {
        error: prepared.error,
        ...(prepared.allowed ? { allowed: prepared.allowed } : {}),
      },
      prepared.status,
    );
  }

  const db = getSql();
  const [repo] = await db<{ full_name: string }[]>`
    SELECT r.full_name
    FROM github_app_repositories r
    JOIN orgs o ON o.installation_id = r.installation_id
    WHERE o.id = ${auth.orgId}::uuid
      AND r.full_name = ${repoFullName}
      AND r.access_state = 'installed'
    LIMIT 1
  `;
  if (!repo) {
    return c.json({ error: "Repository is not installed for this org" }, 400);
  }

  const result = await upsertClientChunks({
    orgId: auth.orgId,
    repoFullName,
    chunks: prepared.chunks,
  });

  if (result.status === "failed") {
    return c.json({ error: result.error ?? "index failed" }, 502);
  }

  return c.json({
    status: result.status,
    chunks: result.chunks,
  });
});
