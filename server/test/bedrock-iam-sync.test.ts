import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BEDROCK_FIGHT_MODELS } from "../src/routes/bedrock";

/**
 * The route's allowlist and the task role's IAM policy are two independent
 * gates, and a model has to clear both. Until now the only thing keeping them
 * in sync was a comment — which failed exactly as it warned it would: Haiku was
 * added to the route, the IAM list was not updated, every test passed locally,
 * and every default-configuration review failed in production with an AWS
 * credentials error that named neither list.
 *
 * Read as text rather than imported: the CDK stack pulls in aws-cdk-lib, which
 * is far too heavy for the server's test run, and the list is a flat literal.
 */
const stackSource = readFileSync(
  join(import.meta.dir, "..", "..", "infra", "lib", "gx-server-stack.ts"),
  "utf8",
);

function iamProfileIds(): string[] {
  const block = stackSource.match(
    /export const bedrockInferenceProfileIds = \[([\s\S]*?)\];/,
  );
  if (!block) throw new Error("bedrockInferenceProfileIds not found in the CDK stack");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("bedrock route allowlist and IAM policy stay in sync", () => {
  test("every model the route allows is invokable by the task role", () => {
    const granted = new Set(iamProfileIds());
    for (const model of BEDROCK_FIGHT_MODELS) {
      expect(
        granted.has(model),
        `${model} is allowed by /gx/bedrock/fight but missing from bedrockInferenceProfileIds ` +
          `in infra/lib/gx-server-stack.ts, so invoking it will fail in production with AccessDenied`,
      ).toBe(true);
    }
  });
});
