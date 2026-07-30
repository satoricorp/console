import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  capture,
  createPostHogClientForTests,
  Events,
  posthogFromEnv,
  resetPostHogClientForTests,
  setPostHogClientForTests,
} from "../src/telemetry/posthog";

describe("posthog telemetry", () => {
  const originalKey = process.env.TX_POSTHOG_KEY;
  const originalHost = process.env.TX_POSTHOG_HOST;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.TX_POSTHOG_KEY;
    } else {
      process.env.TX_POSTHOG_KEY = originalKey;
    }
    if (originalHost === undefined) {
      delete process.env.TX_POSTHOG_HOST;
    } else {
      process.env.TX_POSTHOG_HOST = originalHost;
    }
    resetPostHogClientForTests();
  });

  test("posthogFromEnv returns noop when TX_POSTHOG_KEY is unset", () => {
    delete process.env.TX_POSTHOG_KEY;
    const client = posthogFromEnv();
    expect(() => client.capture("server.test.noop", { ok: true })).not.toThrow();
  });

  test("capture is fire-and-forget and never throws", async () => {
    delete process.env.TX_POSTHOG_KEY;
    resetPostHogClientForTests();
    expect(() => capture("server.test.safe")).not.toThrow();
    await Bun.sleep(10);
  });

  test("posts capture payload shape when key is set", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push({
        url,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response("{}", { status: 200 });
    });

    const client = createPostHogClientForTests({
      apiKey: "phc_test_key",
      host: "https://us.i.posthog.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    setPostHogClientForTests(client);

    capture(
      Events.IngestExtract,
      { event_id: "evt-1", hunk_links_inserted: 2 },
      "org-123",
    );

    await Bun.sleep(50);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://us.i.posthog.com/capture/");
    expect(requests[0]?.body.api_key).toBe("phc_test_key");
    expect(requests[0]?.body.event).toBe("server.ingest.extract");
    const props = requests[0]?.body.properties as Record<string, unknown>;
    expect(props.distinct_id).toBe("org-123");
    expect(props.source).toBe("gx-server");
    expect(props.event_id).toBe("evt-1");
    expect(props.hunk_links_inserted).toBe(2);
  });

  test("posthogFromEnv uses TX_POSTHOG_HOST override", async () => {
    process.env.TX_POSTHOG_KEY = "phc_env_key";
    process.env.TX_POSTHOG_HOST = "https://eu.i.posthog.com";

    const requests: string[] = [];
    const fetchImpl = mock(async (input: RequestInfo | URL) => {
      requests.push(typeof input === "string" ? input : input.toString());
      return new Response("{}", { status: 200 });
    });

    const client = posthogFromEnv(fetchImpl as unknown as typeof fetch);
    client.capture(Events.IndexJob, { status: "enqueue" }, "dev");
    await Bun.sleep(50);

    expect(requests[0]).toBe("https://eu.i.posthog.com/capture/");
  });
});
