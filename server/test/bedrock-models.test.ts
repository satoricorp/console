import { describe, expect, test } from "bun:test";
import { SERVER_BEDROCK_ANTHROPIC_MODEL } from "../src/llm/provider";
import { BEDROCK_FIGHT_MODELS, allowedBedrockModels } from "../src/routes/bedrock";

/**
 * bedrock-runtime rejects bare `anthropic.*` model IDs for on-demand
 * invocation:
 *
 *   ValidationException: Invocation of model ID anthropic.claude-sonnet-4-6
 *   with on-demand throughput isn't supported. Retry your request with the ID
 *   or ARN of an inference profile that contains this model.
 *
 * The server model was the inference profile (2f160eb) and was then reverted to
 * the bare ID (5491d60), which made every Bedrock-backed completion throw. The
 * bare form looks correct in review, so a test has to be the thing that catches
 * it.
 */
describe("Bedrock model IDs are inference profiles", () => {
  const profilePrefixes = ["us.", "eu.", "apac.", "global.", "us-gov."];

  function assertInferenceProfile(model: string): void {
    const looksBare = model.startsWith("anthropic.");
    expect(
      looksBare,
      `${model} is a bare model ID; bedrock-runtime rejects those for on-demand invocation. Use "us.${model}".`,
    ).toBe(false);
    expect(
      profilePrefixes.some((prefix) => model.startsWith(prefix)) || model.startsWith("arn:"),
      `${model} is neither an inference profile ID nor an ARN.`,
    ).toBe(true);
  }

  test("the server's own summary model is an inference profile", () => {
    assertInferenceProfile(SERVER_BEDROCK_ANTHROPIC_MODEL);
  });

  test("every /gx/bedrock/fight model is an inference profile", () => {
    expect(BEDROCK_FIGHT_MODELS.length).toBe(3);
    for (const model of BEDROCK_FIGHT_MODELS) {
      assertInferenceProfile(model);
    }
  });

  test("the allowlist covers the fight trio and the server's own model", () => {
    const allowed = allowedBedrockModels();
    for (const model of [...BEDROCK_FIGHT_MODELS, SERVER_BEDROCK_ANTHROPIC_MODEL]) {
      expect(allowed).toContain(model);
    }
  });

  test("the reviewers are two different Opus generations and the judge is neither", () => {
    const [reviewerA, reviewerB, judge] = BEDROCK_FIGHT_MODELS;
    expect(reviewerA).toContain("opus");
    expect(reviewerB).toContain("opus");
    expect(reviewerA).not.toBe(reviewerB);
    expect(judge).not.toBe(reviewerA);
    expect(judge).not.toBe(reviewerB);
  });
});
