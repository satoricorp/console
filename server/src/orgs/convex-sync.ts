import type postgres from "postgres";

/**
 * Pushes every installation → org mapping this server knows into Convex.
 *
 * Convex needs the mapping to name the namespace an index writes
 * (`gx-{orgId}-{repo}-v2`), and it learns it from forwarded webhook deliveries.
 * That is enough to stay current but not enough to start: on a fresh deploy the
 * table is empty, and nothing fills it until each installation happens to emit
 * an event. Until then `getConnectedRepo` resolves no org, so console search
 * returns nothing and PR chat runs without indexed context — indefinitely for a
 * repository that is not being pushed to.
 *
 * Postgres is the source of truth either way, so this is a projection catching
 * up rather than a migration: it is idempotent, and safe to run on every boot.
 */
export async function syncInstallationOrgsToConvex(db: postgres.Sql): Promise<number> {
  const base = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.TX_CLOUD_API_KEY?.trim();
  if (!base || !apiKey) {
    console.warn(
      "installation -> org sync skipped: CONVEX_SITE_URL or TX_CLOUD_API_KEY is unset, so Convex cannot resolve an org and will not index",
    );
    return 0;
  }

  const rows = await db<
    { installation_id: string; org_id: string; account_login: string | null }[]
  >`
    SELECT o.installation_id, o.id AS org_id, i.account_login
    FROM orgs o
    JOIN github_app_installations i ON i.installation_id = o.installation_id
    WHERE o.installation_id IS NOT NULL
  `;

  if (rows.length === 0) {
    return 0;
  }

  const installations = rows.map((row) => ({
    installationId: Number(row.installation_id),
    orgId: row.org_id,
    accountLogin: row.account_login ?? undefined,
  }));

  const response = await fetch(`${base}/cx/orgs/installations`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "tx-cloud",
    },
    body: JSON.stringify({ installations }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `installation -> org sync failed: ${response.status} ${(await response
        .text()
        .catch(() => ""))
        .slice(0, 200)}`,
    );
  }

  return installations.length;
}
