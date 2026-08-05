import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type * as gxApiServer from "./gx-api-server";

mock.module("server-only", () => ({}));

let getTxApiBaseUrl: typeof gxApiServer.getTxApiBaseUrl;
let gxApiRequest: typeof gxApiServer.gxApiRequest;
let normalizeTxApiPath: typeof gxApiServer.normalizeTxApiPath;

describe("gx api server helpers", () => {
  const originalFetch = globalThis.fetch;
  const originalCloudURL = process.env.GX_CLOUD_URL;
  const originalAPIKey = process.env.GX_CLOUD_API_KEY;

  beforeAll(async () => {
    const gxApi = await import("./gx-api-server");
    getTxApiBaseUrl = gxApi.getTxApiBaseUrl;
    gxApiRequest = gxApi.gxApiRequest;
    normalizeTxApiPath = gxApi.normalizeTxApiPath;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("GX_CLOUD_URL", originalCloudURL);
    restoreEnv("GX_CLOUD_API_KEY", originalAPIKey);
  });

  test("uses GX_CLOUD_URL as an origin", () => {
    process.env.GX_CLOUD_URL = "http://localhost:3201/";

    expect(getTxApiBaseUrl()).toBe("http://localhost:3201");
  });

  test("keeps bookmark paths unprefixed and adds a leading slash", () => {
    expect(normalizeTxApiPath("/bookmarks")).toBe("/bookmarks");
    expect(normalizeTxApiPath("/bookmarks/abc?include_payload=1")).toBe(
      "/bookmarks/abc?include_payload=1",
    );
    expect(normalizeTxApiPath("/v1/reviews/abc")).toBe("/v1/reviews/abc");
    expect(normalizeTxApiPath("bookmarks")).toBe("/bookmarks");
  });

  test("sends console requests to the API", async () => {
    process.env.GX_CLOUD_URL = "http://gx-cloud.test/";
    process.env.GX_CLOUD_API_KEY = "service-token";

    let requested: RequestInfo | URL | undefined;
    let init: RequestInit | undefined;
    globalThis.fetch = ((input: RequestInfo | URL, requestInit?: RequestInit) => {
      requested = input;
      init = requestInit;
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch;

    await gxApiRequest("user-1", "/bookmarks?merge_status=open");

    expect(requested).toBe(
      "http://gx-cloud.test/bookmarks?merge_status=open&format=console",
    );
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer service-token",
      "X-User-Id": "user-1",
    });
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
