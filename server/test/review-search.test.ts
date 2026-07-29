import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { namespaceForOrgRepo } from "../src/indexing/config";
import { resetIndexingFetch, setIndexingFetch } from "../src/indexing/turbopuffer";
import { resolveSearchOrgId } from "../src/routes/search";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

/**
 * /v1/review/search is the CLI's retrieval path: these tests pin the parts the
 * CLI depends on — namespace derivation matching the writers, the exists /
 * missing distinction, source-kind filtering, and the explicit symbol leg.
 */

const openAIKey = "test-openai";
const tpufKey = "test-tpuf";

type CapturedRequest = { url: string; body: unknown };

function stubTurboPuffer(options: {
  metadataStatus?: number;
  metadata?: Record<string, unknown>;
  rows?: unknown[];
  embeddingWidth?: number;
  captured?: CapturedRequest[];
}) {
  setIndexingFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/embeddings")) {
      const width = options.embeddingWidth ?? 1536;
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: Array.from({ length: width }, () => 0.02) }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.endsWith("/metadata")) {
      const status = options.metadataStatus ?? 200;
      if (status !== 200) {
        return new Response("not found", { status });
      }
      return new Response(
        JSON.stringify(
          options.metadata ?? { approx_row_count: 42, last_write_at: "2026-07-27T00:00:00Z" },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.endsWith("/query")) {
      options.captured?.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ rows: options.rows ?? [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch);
}

/** Collect every [field, op, value] clause in a turbopuffer filter tree. */
function filterClauses(node: unknown, out: Array<[string, string, string]> = []) {
  if (!Array.isArray(node)) return out;
  if (node.length === 3 && typeof node[0] === "string" && typeof node[1] === "string" && typeof node[2] === "string") {
    out.push(node as [string, string, string]);
  }
  for (const child of node) filterClauses(child, out);
  return out;
}

function firstLegFilters(body: unknown): Array<[string, string, string]> {
  const record = body as { queries?: Array<{ filters?: unknown }>; filters?: unknown };
  const filters = record.queries?.[0]?.filters ?? record.filters;
  return filterClauses(filters);
}

describeDb("POST /v1/review/search", () => {
  let orgId: string;

  beforeAll(async () => {
    installTestAuth();
    await runMigrations();
    process.env.OPENAI_API_KEY = openAIKey;
    process.env.TURBOPUFFER_API_KEY = tpufKey;

    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${Date.now()}) RETURNING id
    `;
    orgId = org.id;
  });

  afterEach(() => {
    resetIndexingFetch();
    process.env.OPENAI_API_KEY = openAIKey;
    process.env.TURBOPUFFER_API_KEY = tpufKey;
  });

  function request(body: unknown, headers: Record<string, string> = authHeaders("search-user", orgId)) {
    return app.request("http://localhost/v1/review/search", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("rejects missing auth", async () => {
    const res = await app.request("http://localhost/v1/review/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "anything", repo_full_name: "acme/app" }),
    });
    expect(res.status).toBe(401);
  });

  test("rejects bad target, empty query, malformed repo, unknown source kind", async () => {
    expect((await request({ target: "everything", query: "q" })).status).toBe(400);
    expect((await request({ query: "  ", repo_full_name: "acme/app" })).status).toBe(400);
    expect((await request({ query: "q", repo_full_name: "not-a-repo" })).status).toBe(400);
    const res = await request({
      query: "q",
      repo_full_name: "acme/app",
      source_kinds: ["secret_dump"],
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { allowed?: string[] };
    expect(json.allowed).toContain("code_file");
  });

  test("reports unavailable when indexing keys are not configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
    const res = await request({ query: "q", repo_full_name: "acme/app" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { available: boolean; reason?: string };
    expect(json.available).toBe(false);
    expect(json.reason).toContain("not configured");
  });

  test("a namespace that does not exist is missing, not an error", async () => {
    stubTurboPuffer({ metadataStatus: 404 });
    const res = await request({ query: "q", repo_full_name: "acme/app" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      available: boolean;
      exists: boolean;
      namespace: string;
      rows: unknown[];
    };
    expect(json.available).toBe(true);
    expect(json.exists).toBe(false);
    expect(json.namespace).toBe(namespaceForOrgRepo(orgId, "acme/app"));
    expect(json.rows).toEqual([]);
  });

  test("repo search filters by org and source kind, honors the symbol query, trims rows", async () => {
    const captured: CapturedRequest[] = [];
    stubTurboPuffer({
      captured,
      rows: [
        {
          id: "row-1",
          $dist: 0.12,
          attributes: {
            text: "func resolveStore() {}",
            source_kind: "code_file",
            file_path: "internal/codereview/code_index_context.go",
            start_line: 244,
            org_id: "org",
            vector: [0.1, 0.2],
          },
        },
      ],
    });

    const res = await request({
      query: "how does the review resolve its store",
      symbol_query: "resolveStore CodeIndexRetriever",
      repo_full_name: "acme/app",
      source_kinds: ["code_file"],
      limit: 500,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      available: boolean;
      exists: boolean;
      namespace: string;
      approx_row_count: number;
      last_write_at: string;
      rows: Array<{ id: string; text: string; attributes: Record<string, unknown> }>;
    };
    expect(json.exists).toBe(true);
    expect(json.namespace).toBe(namespaceForOrgRepo(orgId, "acme/app"));
    expect(json.approx_row_count).toBe(42);
    expect(json.last_write_at).toBe("2026-07-27T00:00:00Z");
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0]!.text).toBe("func resolveStore() {}");
    // text and vector are not duplicated into attributes.
    expect(json.rows[0]!.attributes.text).toBeUndefined();
    expect(json.rows[0]!.attributes.vector).toBeUndefined();
    expect(json.rows[0]!.attributes.file_path).toBe("internal/codereview/code_index_context.go");

    expect(captured).toHaveLength(1);
    const body = captured[0]!.body as {
      queries?: Array<{ rank_by?: unknown[]; limit?: { total?: number } }>;
    };
    // Hybrid: vector + text BM25 + symbol BM25 legs, fused.
    expect(body.queries).toHaveLength(3);
    const symbolLeg = body.queries!.find(
      (leg) => Array.isArray(leg.rank_by) && leg.rank_by[0] === "symbol",
    );
    expect(symbolLeg?.rank_by?.[2]).toBe("resolveStore CodeIndexRetriever");
    // limit=500 clamps to the route ceiling.
    expect(body.queries![0]!.limit?.total).toBe(100);

    const clauses = filterClauses((body.queries![0] as { filters?: unknown }).filters);
    expect(clauses).toContainEqual(["org_id", "Eq", orgId]);
    expect(clauses).toContainEqual(["repo_full_name", "Eq", "acme/app"]);
    expect(clauses).toContainEqual(["source_kind", "Eq", "code_file"]);
  });

  test("knowledge search hits the shared corpus without an org filter", async () => {
    const captured: CapturedRequest[] = [];
    stubTurboPuffer({
      captured,
      embeddingWidth: 512,
      rows: [
        {
          id: "kn-1",
          attributes: { text: "Prefer parameterized queries.", source_kind: "review_corpus" },
        },
      ],
    });

    const res = await request({ target: "knowledge", query: "sql injection review guidance" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      namespace: string;
      exists: boolean;
      rows: Array<{ id: string }>;
    };
    expect(json.namespace).toBe("gx-review-knowledge");
    expect(json.exists).toBe(true);
    expect(json.rows).toHaveLength(1);

    const clauses = firstLegFilters(captured[0]!.body);
    expect(clauses).toContainEqual(["source_kind", "Eq", "review_corpus"]);
    expect(clauses.find((clause) => clause[0] === "org_id")).toBeUndefined();
  });
});

describeDb("resolveSearchOrgId", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  async function seedOrgWithRepo(fullName: string, installationId: number, memberGithubUserId?: number) {
    const db = getSql();
    const now = Date.now();
    await db`
      INSERT INTO github_app_installations (installation_id, account_login, updated_at_ms)
      VALUES (${installationId}, ${fullName.split("/")[0]!}, ${now})
      ON CONFLICT (installation_id) DO NOTHING
    `;
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (installation_id, plan, created_at_ms)
      VALUES (${installationId}, 'free', ${now})
      ON CONFLICT (installation_id) DO UPDATE SET plan = orgs.plan
      RETURNING id
    `;
    await db`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name, updated_at_ms
      ) VALUES (
        ${Math.floor(Math.random() * 1_000_000_000)}, ${installationId}, ${fullName},
        ${fullName.split("/")[0]!}, ${fullName.split("/")[1]!}, ${now}
      )
    `;
    if (memberGithubUserId !== undefined) {
      await db`
        INSERT INTO org_members (org_id, github_user_id, created_at_ms)
        VALUES (${org.id}, ${memberGithubUserId}, ${now})
        ON CONFLICT (org_id, github_user_id) DO NOTHING
      `;
    }
    return org.id;
  }

  test("resolves the org whose installation covers the repo, via membership", async () => {
    const db = getSql();
    const githubUserId = 424_242;
    const [personalOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${Date.now()}) RETURNING id
    `;
    const repoOrg = await seedOrgWithRepo("megacorp/monolith", 90_001, githubUserId);

    const resolved = await resolveSearchOrgId(
      db,
      { orgId: personalOrg.id, githubUserId },
      "megacorp/monolith",
    );
    expect(resolved).toBe(repoOrg);
  });

  test("prefers the auth org when it also covers the repo", async () => {
    const db = getSql();
    const githubUserId = 424_243;
    const authOrg = await seedOrgWithRepo("acme/shared", 90_002, githubUserId);
    await seedOrgWithRepo("acme/shared", 90_003, githubUserId);

    const resolved = await resolveSearchOrgId(
      db,
      { orgId: authOrg, githubUserId },
      "acme/shared",
    );
    expect(resolved).toBe(authOrg);
  });

  test("falls back to the auth org when the repo is not connected", async () => {
    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${Date.now()}) RETURNING id
    `;
    const resolved = await resolveSearchOrgId(
      db,
      { orgId: org.id, githubUserId: null },
      "nobody/nowhere",
    );
    expect(resolved).toBe(org.id);
  });
});
