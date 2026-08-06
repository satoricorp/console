import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

export type LLMCompletionUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type LLMCompletion = {
  text: string;
  model: string;
  /** Absent when the provider did not report usage (e.g. the mock). */
  usage?: LLMCompletionUsage;
};

export type LLMProvider = {
  name: string;
  label?: string;
  complete(system: string, user: string): Promise<LLMCompletion>;
};

const defaultOpenAIBaseURL = "https://api.openai.com/v1";
const defaultModel = "gpt-4o-mini";

/**
 * The Bedrock model this server calls directly (PR summaries, review plans,
 * `@gx` mention answers).
 *
 * It MUST be the `us.`-prefixed inference profile form. bedrock-runtime rejects
 * the bare `anthropic.*` ID for on-demand invocation with
 *
 *   ValidationException: Invocation of model ID anthropic.claude-sonnet-4-6
 *   with on-demand throughput isn't supported. Retry your request with the ID
 *   or ARN of an inference profile that contains this model.
 *
 * — verified live against bedrock-runtime in both us-east-1 and us-west-2.
 * The inference profile was introduced in 2f160eb and silently reverted to the
 * bare ID in 5491d60, which made every Bedrock-backed completion throw (there
 * is no fallback: generateSummary lets the provider error propagate, so the
 * GitHub webhook 500s instead of posting a summary). bedrock-models.test.ts is
 * the regression test that keeps the bare form from coming back.
 */
export const SERVER_BEDROCK_ANTHROPIC_MODEL = "us.anthropic.claude-sonnet-4-6";

function openAIBaseURL(): string {
  const baseURL = (
    process.env.GX_OPENAI_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    defaultOpenAIBaseURL
  ).replace(/\/+$/, "");
  return baseURL.endsWith("/v1") ? baseURL : `${baseURL}/v1`;
}

function openAIModel(): string {
  return process.env.GX_REVIEW_OPENAI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || defaultModel;
}

/** Deterministic mock for tests and local dev when OPENAI_API_KEY is unset. */
export function createMockProvider(contextHint?: string): LLMProvider {
  return {
    name: "mock",
    label: "Mock",
    async complete(system: string, user: string): Promise<LLMCompletion> {
      if (/GitHub pull request comment thread/i.test(system)) {
        if (/Available sources:\s*\(none\)/i.test(user)) {
          return {
            text: JSON.stringify({
              answer: "I couldn't answer from the available review context because no citeable sources were provided.",
              citations: [],
            }),
            model: "mock",
          };
        }
        return {
          text: JSON.stringify({
            answer: "Start with the changed runtime file and the test assertion it depends on. [S1]",
            citations: ["S1"],
          }),
          model: "mock",
        };
      }

      if (/focused human review plan/i.test(system) || /notableChanges/i.test(system)) {
        const files = [...user.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1]!.trim());
        const fileList = [...user.matchAll(/files=\d+:\s*(.+)$/gm)].flatMap((m) =>
          (m[1] ?? "").split(",").map((f) => f.trim()).filter(Boolean),
        );
        const changed = [...new Set([...files, ...fileList])].filter(Boolean);
        const selfReport =
          user.match(/Self-report:\s*(.+)/)?.[1]?.trim() ||
          contextHint?.slice(0, 120) ||
          "Implement the requested changes";
        const notableFiles = changed.slice(0, 3);
        const categories = [
          "behavior",
          "failure-path",
          "boundary",
        ] as const;
        const plan = {
          schemaVersion: 1,
          narrative: {
            summary: `Purpose: ${selfReport.slice(0, 200)}. Original intent was to land these agent-authored changes with human review on the highest-risk surfaces.`,
            summaryTeaser: `${selfReport.slice(0, 100)}.`,
            why: "The agent touched shared patterns and high-blast-radius paths; humans should confirm the architectural choices before merge.",
            whyTeaser: "Shared patterns and high blast radius need a human pass.",
            attributionSources: [
              { source: "agent-sessions", pct: 65 },
              { source: "codebase", pct: 20 },
              { source: "previous-prs", pct: 10 },
              { source: "docs", pct: 5 },
            ],
            selfReportQuote: selfReport.slice(0, 240),
          },
          notableChanges: notableFiles.slice(0, 5).map((file, index) => ({
            rank: index + 1,
            category: categories[index % categories.length],
            title: `Review ${file}`,
            whyItMatters:
              "This change alters a shared surface that other code depends on. Confirm the approach matches repo conventions and that blast radius is understood.",
            anchor: {
              file,
              lineStart: 1,
              lineEnd: 20,
              revisionChangeId: undefined,
            },
            anchorConfidence: "file",
            attribution: { authorship: "agent", tool: "mock", model: "mock" },
          })),
          safeToSkim: changed
            .filter((f) => !notableFiles.slice(0, 5).includes(f))
            .map((file) => ({
              file,
              reason: "Supporting or low-risk change.",
            })),
          revisions: [],
        };
        return { text: JSON.stringify(plan), model: "mock" };
      }

      const intent = contextHint?.slice(0, 80) || "Changes from captured agent sessions";
      const fileMatch = user.match(/Hunk links[\s\S]*?- ([^\s:]+):/i);
      const primaryFile = fileMatch?.[1] ?? "server/src/summary/generate.ts";
      const text = [
        "> 🟢 👀 **Quick scan** — standard change; skim the notable changes.",
        "",
        intent,
        "",
        "## Blast Radius",
        "",
        "🟢 LOW (1 file(s), 1 area(s), +10/-1 lines).",
        "Contained to review/summary paths; no production runtime path is changed.",
        "",
        "## Notable Changes",
        "",
        `- ${primaryFile} ranks changed files using hunk-linked review evidence`,
        `  Attribution: agent-sessions ${primaryFile}`,
        "",
        "*Generated by gx.*",
      ].join("\n");

      void system;
      return { text, model: "mock" };
    },
  };
}

export function awsRegion(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
}

export function bedrockConfigured(): boolean {
  return Boolean(
    process.env.AWS_REGION?.trim() ||
      process.env.AWS_DEFAULT_REGION?.trim() ||
      process.env.AWS_PROFILE?.trim() ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim() ||
      process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim() ||
      process.env.AWS_ACCESS_KEY_ID?.trim(),
  );
}

let bedrockClient: BedrockRuntimeClient | null = null;

/** The one Bedrock client. The /gx/bedrock/fight passthrough shares it so the
 * server has a single place where region and the credential chain are decided. */
export function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({ region: awsRegion() });
  }
  return bedrockClient;
}

/** Test seam: swap in a fake client (anything with `send`), or pass null to
 * drop the cached one so the next call rebuilds it from the current env. */
export function setBedrockClientForTesting(client: BedrockRuntimeClient | null): void {
  bedrockClient = client;
}

async function bedrockAnthropicComplete(system: string, user: string): Promise<LLMCompletion> {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: user }],
  });

  const response = await getBedrockClient().send(new InvokeModelCommand({
    accept: "application/json",
    body: new TextEncoder().encode(body),
    contentType: "application/json",
    modelId: SERVER_BEDROCK_ANTHROPIC_MODEL,
  }));

  if (!response.body) {
    throw new Error("Bedrock Anthropic response returned empty body");
  }

  const responseText = new TextDecoder().decode(response.body);
  const json = JSON.parse(responseText) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  const text =
    json.content
      ?.filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
      .trim() ?? "";
  if (!text) {
    throw new Error("Bedrock Anthropic response returned empty content");
  }

  const completion: LLMCompletion = { text, model: SERVER_BEDROCK_ANTHROPIC_MODEL };
  // Both counts must be present: a usage object without them would otherwise
  // meter as a phantom zero-token call.
  if (
    typeof json.usage?.input_tokens === "number" &&
    typeof json.usage.output_tokens === "number"
  ) {
    completion.usage = {
      inputTokens: json.usage.input_tokens,
      outputTokens: json.usage.output_tokens,
      ...(typeof json.usage.cache_read_input_tokens === "number"
        ? { cacheReadTokens: json.usage.cache_read_input_tokens }
        : {}),
      ...(typeof json.usage.cache_creation_input_tokens === "number"
        ? { cacheWriteTokens: json.usage.cache_creation_input_tokens }
        : {}),
    };
  }
  return completion;
}

function extractResponseText(json: {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}): string {
  const outputText = json.output_text?.trim();
  if (outputText) {
    return outputText;
  }

  return (
    json.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text" && typeof content.text === "string")
      .map((content) => content.text)
      .join("")
      .trim() ?? ""
  );
}

async function openAIComplete(system: string, user: string): Promise<LLMCompletion> {
  const apiKey = process.env.GX_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY or GX_OPENAI_API_KEY is not set");
  }

  const model = openAIModel();
  const response = await fetch(`${openAIBaseURL()}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: system,
      input: user,
      max_output_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI response failed: ${response.status}${body ? ` ${body.slice(0, 500)}` : ""}`,
    );
  }

  const json = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  };
  const text = extractResponseText(json);
  if (!text) {
    throw new Error("OpenAI response returned empty content");
  }

  const completion: LLMCompletion = { text, model: json.model ?? model };
  if (
    typeof json.usage?.input_tokens === "number" &&
    typeof json.usage.output_tokens === "number"
  ) {
    const cachedTokens = json.usage.input_tokens_details?.cached_tokens;
    completion.usage = {
      // input_tokens includes the cached share; split it out so cache reads
      // are priced at the cache rate rather than the full input rate.
      inputTokens: Math.max(0, json.usage.input_tokens - (cachedTokens ?? 0)),
      outputTokens: json.usage.output_tokens,
      ...(typeof cachedTokens === "number" ? { cacheReadTokens: cachedTokens } : {}),
    };
  }
  return completion;
}

export function createLLMProvider(contextHint?: string): LLMProvider {
  const gxOpenAIKey = process.env.GX_OPENAI_API_KEY?.trim();
  const plainOpenAIKey = process.env.OPENAI_API_KEY?.trim();
  const apiKey = gxOpenAIKey || plainOpenAIKey;
  if (!apiKey || apiKey === "mock") {
    return createMockProvider(contextHint);
  }
  if (!gxOpenAIKey && bedrockConfigured()) {
    return {
      name: "anthropic",
      label: "Anthropic",
      complete: bedrockAnthropicComplete,
    };
  }

  return {
    name: "openai",
    label: "OpenAI",
    complete: openAIComplete,
  };
}

export function createReviewProviders(contextHint?: string): LLMProvider[] {
  if (process.env.GX_REVIEW_MODELS?.trim() === "mock") {
    return [createMockProvider(contextHint)];
  }

  const providers: LLMProvider[] = [];
  const apiKey = process.env.GX_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (apiKey && apiKey !== "mock") {
    providers.push({
      name: "openai",
      label: "OpenAI",
      complete: openAIComplete,
    });
  }

  if (bedrockConfigured()) {
    providers.push({
      name: "anthropic",
      label: "Anthropic",
      complete: bedrockAnthropicComplete,
    });
  }

  return providers.length > 0 ? providers : [createMockProvider(contextHint)];
}
