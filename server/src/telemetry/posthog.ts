const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** V1 server PostHog event names (no "brief"). */
export const Events = {
  IngestExtract: "server.ingest.extract",
  IngestSession: "server.ingest.session",
  SummaryGenerated: "server.summary.generated",
  SummaryPosted: "server.summary.posted",
  SummaryQuotaBlocked: "server.summary.quota_blocked",
  GitHubWebhook: "server.github.webhook",
  IndexJob: "server.index.job",
  GxMentionHandled: "server.gx_mention.handled",
} as const;

export type PostHogEvent = (typeof Events)[keyof typeof Events];

export type PostHogClient = {
  capture: (
    event: string,
    properties?: Record<string, unknown>,
    distinctId?: string,
  ) => void;
};

type PostHogConfig = {
  apiKey: string;
  host: string;
  fetchImpl: typeof fetch;
};

const noopClient: PostHogClient = {
  capture() {},
};

let defaultClient: PostHogClient | null = null;

function posthogConfigFromEnv(): PostHogConfig | null {
  const apiKey = (process.env.GX_POSTHOG_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const host = (
    process.env.GX_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST
  )
    .trim()
    .replace(/\/+$/, "");
  return { apiKey, host, fetchImpl: fetch };
}

function createClient(config: PostHogConfig): PostHogClient {
  return {
    capture(event, properties = {}, distinctId = "dev") {
      const payload = {
        api_key: config.apiKey,
        event,
        properties: {
          distinct_id: distinctId,
          source: "gx-server",
          ...properties,
        },
      };

      void (async () => {
        try {
          const response = await config.fetchImpl(`${config.host}/capture/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5_000),
          });
          await response.arrayBuffer().catch(() => undefined);
        } catch {
          // fire-and-forget — never propagate telemetry failures
        }
      })();
    },
  };
}

/** Returns a PostHog client or no-op when GX_POSTHOG_KEY is unset. */
export function posthogFromEnv(fetchImpl: typeof fetch = fetch): PostHogClient {
  const config = posthogConfigFromEnv();
  if (!config) {
    return noopClient;
  }
  return createClient({ ...config, fetchImpl });
}

function getDefaultClient(): PostHogClient {
  if (!defaultClient) {
    defaultClient = posthogFromEnv();
  }
  return defaultClient;
}

/** Async fire-and-forget capture; never throws to callers. */
export function capture(
  event: string,
  properties?: Record<string, unknown>,
  distinctId?: string,
): void {
  try {
    getDefaultClient().capture(event, properties, distinctId);
  } catch {
    // swallow — telemetry must not affect request handling
  }
}

/** Test helper: reset module singleton after env/fetch overrides. */
export function resetPostHogClientForTests(): void {
  defaultClient = null;
}

/** Test helper: inject a custom client (e.g. with mocked fetch). */
export function setPostHogClientForTests(client: PostHogClient | null): void {
  defaultClient = client;
}

export function createPostHogClientForTests(
  config: PostHogConfig,
): PostHogClient {
  return createClient(config);
}
