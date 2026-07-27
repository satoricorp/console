import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import {
  resetIndexingFetch,
  setIndexingFetch,
} from "../src/indexing/turbopuffer";
import { setOrgMemberCheckForTests } from "../src/orgs/members";
import {
  ALLOWED_INDEX_SOURCE_KINDS,
  MAX_CHUNK_CHARS,
  MAX_CHUNKS_PER_REQUEST,
  prepareIndexChunks,
} from "../src/routes/index-chunks";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

describe("prepareIndexChunks", () => {
  test("accepts allowlisted kinds and strips client org_id", () => {
    const result = prepareIndexChunks([
      {
        text: "export const x = 1",
        source_kind: "code_file",
        chunk_hash: "h1",
        file: "src/a.ts",
        attributes: { org_id: "evil-org", foo: "bar" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chunks[0]!.sourceKind).toBe("code_file");
    expect(result.chunks[0]!.attributes?.org_id).toBeUndefined();
    expect(result.chunks[0]!.attributes?.foo).toBe("bar");
  });

  test("rejects disallowed source_kind", () => {
    const result = prepareIndexChunks([
      { text: "fake summary", source_kind: "code_review_summary" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not allowed");
    expect(result.allowed).toEqual([...ALLOWED_INDEX_SOURCE_KINDS]);
  });

  test("rejects empty chunks", () => {
    expect(prepareIndexChunks([])).toMatchObject({ ok: false, error: "chunks required" });
    expect(prepareIndexChunks(undefined)).toMatchObject({
      ok: false,
      error: "chunks required",
    });
  });

  test("rejects oversize batch and text", () => {
    const tooMany = Array.from({ length: MAX_CHUNKS_PER_REQUEST + 1 }, (_, i) => ({
      text: `chunk ${i}`,
      source_kind: "code_file",
    }));
    expect(prepareIndexChunks(tooMany)).toMatchObject({
      ok: false,
      error: `At most ${MAX_CHUNKS_PER_REQUEST} chunks per request`,
    });

    const huge = prepareIndexChunks([
      { text: "x".repeat(MAX_CHUNK_CHARS + 1), source_kind: "session_transcript" },
    ]);
    expect(huge.ok).toBe(false);
    if (huge.ok) return;
    expect(huge.error).toContain(`exceeds ${MAX_CHUNK_CHARS}`);
  });

  test("accepts review_policy", () => {
    const result = prepareIndexChunks([
      { text: "# Review policy", source_kind: "review_policy", file: "REVIEW.md" },
    ]);
    expect(result.ok).toBe(true);
  });
});

describeDb("POST /v1/index/chunks", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    installTestAuth();
    await runMigrations();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    resetIndexingFetch();
    setOrgMemberCheckForTests(null);
    await closeDatabase();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetIndexingFetch();
    setOrgMemberCheckForTests(null);
  });

  async function seedInstalledRepo(): Promise<{ orgId: string; repoFullName: string }> {
    const db = getSql();
    const now = Date.now();
    const installationId = Math.floor(Math.random() * 1_000_000_000) + 2_000_000;
    const repoFullName = `acme/index-chunks-${crypto.randomUUID().slice(0, 8)}`;

    await db`
      INSERT INTO github_app_installations (
        installation_id, account_login, updated_at_ms
      ) VALUES (
        ${installationId}, 'acme', ${now}
      )
      ON CONFLICT (installation_id) DO NOTHING
    `;
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (installation_id, plan, created_at_ms)
      VALUES (${installationId}, 'free', ${now})
      ON CONFLICT (installation_id) DO UPDATE SET plan = EXCLUDED.plan
      RETURNING id
    `;
    await db`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name,
        access_state, updated_at_ms
      ) VALUES (
        ${installationId + 99}, ${installationId}, ${repoFullName}, 'acme', 'repo',
        'installed', ${now}
      )
      ON CONFLICT (github_repo_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        access_state = 'installed'
    `;
    return { orgId: org.id, repoFullName };
  }

  test("indexes allowlisted chunks for an installed repo", async () => {
    const { orgId, repoFullName } = await seedInstalledRepo();
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";

    const upsertBodies: unknown[] = [];
    setIndexingFetch(
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/embeddings")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
          const n = body.input?.length ?? 1;
          return new Response(
            JSON.stringify({
              data: Array.from({ length: n }, (_, index) => ({
                index,
                embedding: Array.from({ length: 512 }, () => 0.01),
              })),
            }),
            { status: 200 },
          );
        }
        if (url.includes("turbopuffer.com")) {
          upsertBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return new Response(JSON.stringify({ status: "OK" }), { status: 200 });
        }
        return new Response("nope", { status: 404 });
      }) as typeof fetch,
    );

    const res = await app.request("http://localhost/v1/index/chunks", {
      method: "POST",
      headers: {
        ...authHeaders("index-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo_full_name: repoFullName,
        chunks: [
          {
            text: "function hello() {}",
            source_kind: "code_file",
            chunk_hash: "hash-a",
            file: "src/hello.ts",
            attributes: { org_id: "should-be-stripped" },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; chunks: number };
    expect(json.status).toBe("indexed");
    expect(json.chunks).toBe(1);
    expect(upsertBodies.length).toBeGreaterThan(0);
    const row = (upsertBodies[0] as { upsert_rows?: Array<Record<string, unknown>> })
      .upsert_rows?.[0];
    expect(row?.org_id).toBe(orgId);
    expect(row?.source_kind).toBe("code_file");
  });

  test("rejects unknown repo for org", async () => {
    const { orgId } = await seedInstalledRepo();
    const res = await app.request("http://localhost/v1/index/chunks", {
      method: "POST",
      headers: {
        ...authHeaders("index-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo_full_name: "other/not-installed",
        chunks: [{ text: "x", source_kind: "code_file" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Repository is not installed for this org",
    });
  });

  test("rejects disallowed source_kind before upsert", async () => {
    const { orgId, repoFullName } = await seedInstalledRepo();
    const res = await app.request("http://localhost/v1/index/chunks", {
      method: "POST",
      headers: {
        ...authHeaders("index-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo_full_name: repoFullName,
        chunks: [{ text: "x", source_kind: "code_review_summary" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not allowed");
  });

  test("rejects GitHub token for non-member org", async () => {
    const { orgId, repoFullName } = await seedInstalledRepo();
    const prevKey = process.env.GX_CLOUD_API_KEY;
    delete process.env.GX_CLOUD_API_KEY;
    setOrgMemberCheckForTests(async () => false);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 999, login: "outsider" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      const res = await app.request("http://localhost/v1/index/chunks", {
        method: "POST",
        headers: {
          Authorization: "Bearer gho_outsider",
          "X-Org-Id": orgId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo_full_name: repoFullName,
          chunks: [{ text: "x", source_kind: "code_file" }],
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      if (prevKey === undefined) delete process.env.GX_CLOUD_API_KEY;
      else process.env.GX_CLOUD_API_KEY = prevKey;
      installTestAuth();
    }
  });
});