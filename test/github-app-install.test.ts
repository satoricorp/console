import { afterEach, describe, expect, test } from "bun:test";
import { installationIdForOwner } from "../convex/githubAppInstall";

const originalFetch = globalThis.fetch;
const originalAppId = process.env.GITHUB_APP_ID;

const APP_ID = 3820402;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAppId === undefined) {
    delete process.env.GITHUB_APP_ID;
    return;
  }
  process.env.GITHUB_APP_ID = originalAppId;
});

function mockInstallations(
  installations: Array<{ id: number; app_id: number; login?: string }>,
) {
  process.env.GITHUB_APP_ID = String(APP_ID);
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        installations: installations.map((installation) => ({
          id: installation.id,
          app_id: installation.app_id,
          account: { login: installation.login },
        })),
      }),
      { status: 200 },
    )) as typeof fetch;
}

describe("installationIdForOwner", () => {
  test("matches the installation on the repository owner", async () => {
    mockInstallations([
      { id: 111, app_id: APP_ID, login: "joelachance" },
      { id: 222, app_id: APP_ID, login: "satoricorp" },
    ]);

    expect(await installationIdForOwner("gho_x", "satoricorp")).toBe(222);
  });

  test("matches the owner case-insensitively", async () => {
    mockInstallations([{ id: 222, app_id: APP_ID, login: "SatoriCorp" }]);

    expect(await installationIdForOwner("gho_x", "satoricorp")).toBe(222);
  });

  // The regression this file exists for. A lone installation used to be
  // returned for any owner, which filed the repository under the wrong org and
  // wrote it to that org's Turbopuffer namespace — silently, because the index
  // looks healthy from every angle except the org it landed in.
  test("does not fall back to a lone installation on a different account", async () => {
    mockInstallations([{ id: 111, app_id: APP_ID, login: "joelachance" }]);

    expect(await installationIdForOwner("gho_x", "collabute")).toBeNull();
  });

  test("ignores installations belonging to another GitHub App", async () => {
    mockInstallations([{ id: 999, app_id: 12345, login: "satoricorp" }]);

    expect(await installationIdForOwner("gho_x", "satoricorp")).toBeNull();
  });

  test("returns null when the user has no installations at all", async () => {
    mockInstallations([]);

    expect(await installationIdForOwner("gho_x", "satoricorp")).toBeNull();
  });

  test("returns null when GITHUB_APP_ID is unset", async () => {
    mockInstallations([{ id: 222, app_id: APP_ID, login: "satoricorp" }]);
    delete process.env.GITHUB_APP_ID;

    expect(await installationIdForOwner("gho_x", "satoricorp")).toBeNull();
  });
});
