import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";
import app from "../src/app";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb, hasDatabase as hasDb } from "./db-gate";

const orgId = "00000000-0000-4000-8000-000000000221";

if (hasDb) {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    installTestAuth();
    await runMigrations();
    await getSql()`
      INSERT INTO orgs (id, plan, created_at_ms)
      VALUES (${orgId}, 'free', ${Date.now()})
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
  });
}

describeDb("reported logs API", () => {
  test("POST /v1/reported-logs stores a user report", async () => {
    const response = await app.request("/v1/reported-logs", {
      method: "POST",
      // requireAuth reads X-User-Id / X-Org-Id. The old X-GX-* spelling was
      // never read by anything, so auth silently fell through to the local-dev
      // identity and the row was attributed to "local-user".
      headers: {
        "Content-Type": "application/json",
        ...authHeaders("user-1", orgId),
      },
      body: JSON.stringify({
        gx_version: "dev",
        os: "darwin",
        arch: "arm64",
        repo_root: "/repo",
        repo_full_name: "satoricorp/gx",
        cloud_url: "http://localhost:3201",
        error: "publish failed",
        status_error: "status failed",
        logs: [{ path: "publish.log", content: "boom" }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { id: string };
    expect(body.id).toBeTruthy();

    const [row] = await getSql()<{
      user_id: string;
      repo_full_name: string;
      error: string;
      status_error: string;
      log_count: number;
      logs: Array<{ path: string; content: string }>;
    }[]>`
      SELECT user_id, repo_full_name, error, status_error, log_count, logs
      FROM reported_logs
      WHERE id = ${body.id}
    `;

    expect(row).toMatchObject({
      user_id: "user-1",
      repo_full_name: "satoricorp/gx",
      error: "publish failed",
      status_error: "status failed",
      log_count: 1,
    });
    expect(row.logs).toEqual([{ path: "publish.log", content: "boom" }]);
  });
});
