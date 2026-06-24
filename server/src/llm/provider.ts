import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

export type LLMCompletion = {
  text: string;
  model: string;
};

export type LLMProvider = {
  name: string;
  label?: string;
  complete(system: string, user: string): Promise<LLMCompletion>;
};

const defaultOpenAIBaseURL = "https://api.openai.com/v1";
const defaultModel = "gpt-4o-mini";
const bedrockAnthropicModel = "us.anthropic.claude-sonnet-4-6";

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
        const citationIds = [...new Set([...user.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]))];
        const firstCitation = citationIds[0];
        if (firstCitation) {
          return {
            text: JSON.stringify({
              answer: `Start with the changed runtime file and the test assertion it depends on. [${firstCitation}]`,
              citations: [firstCitation],
            }),
            model: "mock",
          };
        }
        return {
          text: JSON.stringify({
            answer: "I couldn't answer from the available review context because no citeable sources were provided.",
            citations: [],
          }),
          model: "mock",
        };
      }

      const intent = contextHint?.slice(0, 80) || "Changes from captured agent sessions";
      const text = [
        "Review: Mostly safe 🟢",
        "Purpose",
        intent,
        "Most important changes:",
        "- server/src/summary/generate.ts:1-40 uses hunk-linked review evidence to rank changed files",
        "Blast Radius: Contained (tests)",
        "- Could affect playground review output; no production runtime path is changed",
        "Agent Friction:",
        "- Session linkage confidence varies by match tier; no weak test rewrite detected",
      ].join("\n");

      void system;
      void user;
      return { text, model: "mock" };
    },
  };
}

function awsRegion(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
}

function bedrockConfigured(): boolean {
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

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({ region: awsRegion() });
  }
  return bedrockClient;
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
    modelId: bedrockAnthropicModel,
  }));

  if (!response.body) {
    throw new Error("Bedrock Anthropic response returned empty body");
  }

  const responseText = new TextDecoder().decode(response.body);
  const json = JSON.parse(responseText) as {
    content?: Array<{ type?: string; text?: string }>;
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

  return { text, model: bedrockAnthropicModel };
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
  };
  const text = extractResponseText(json);
  if (!text) {
    throw new Error("OpenAI response returned empty content");
  }

  return { text, model: json.model ?? model };
}

export function createLLMProvider(contextHint?: string): LLMProvider {
  const apiKey = process.env.GX_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (apiKey === "mock") {
    return createMockProvider(contextHint);
  }

  if (apiKey && apiKey !== "mock") {
    return {
      name: "openai",
      label: "OpenAI",
      complete: openAIComplete,
    };
  }

  if (bedrockConfigured()) {
    return {
      name: "anthropic",
      label: "Anthropic",
      complete: bedrockAnthropicComplete,
    };
  }

  return createMockProvider(contextHint);
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
