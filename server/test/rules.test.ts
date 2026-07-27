import { afterAll, describe, expect, test } from "bun:test";
import { classifyReviewComment } from "../src/rules/classifier";
import { containsGxMention, handleGxMention } from "../src/gx-mention/handler";
import { describeDb } from "./db-gate";

// Unique per process run. bookmarks carries a UNIQUE index on
// (user_id, repo_full_name, branch_name) (migration 018), so a fixed user id
// seeds cleanly exactly once per database and then fails with 23505 on every
// later run. Tests must not assume the database was just created.
const rulesUserId = `test-user-${crypto.randomUUID()}`;

describe("classifyReviewComment", () => {
  test("maps approved review state to approve decision", () => {
    const result = classifyReviewComment({
      body: "Looks good to me.",
      reviewer: "alice",
      reviewState: "approved",
    });
    expect(result.decision.action).toBe("approve");
  });

  test("maps changes_requested review state", () => {
    const result = classifyReviewComment({
      body: "Please fix the error handling.",
      reviewer: "bob",
      reviewState: "changes_requested",
    });
    expect(result.decision.action).toBe("request_changes");
  });

  test("infers binding rule from never X in Y", () => {
    const result = classifyReviewComment({
      body: "We should never use var in src/",
      reviewer: "carol",
      reviewState: "commented",
      repoScope: "acme/gx",
    });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.strength).toBe("binding");
    expect(result.rules[0]?.scopeExpr).toBe("src/");
    expect(result.rules[0]?.ruleText).toContain("use var");
  });

  test("infers preference rule from prefer", () => {
    const result = classifyReviewComment({
      body: "Prefer to keep handlers thin in server/src/",
      reviewer: "dana",
      reviewState: "commented",
      repoScope: "acme/gx",
    });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.strength).toBe("preference");
    expect(result.rules[0]?.ruleText.toLowerCase()).toContain("keep handlers thin");
  });

  test("infers request_changes from blocking language", () => {
    const result = classifyReviewComment({
      body: "This is blocking — must fix before merge.",
      reviewer: "erin",
      reviewState: null,
    });
    expect(result.decision.action).toBe("request_changes");
  });

  test("defaults to comment for neutral feedback", () => {
    const result = classifyReviewComment({
      body: "Nit: rename this variable.",
      reviewer: "frank",
      reviewState: null,
    });
    expect(result.decision.action).toBe("comment");
    expect(result.rules).toHaveLength(0);
  });
});

describe("gx mention helpers", () => {
  test("detects @gx mentions case-insensitively", () => {
    expect(containsGxMention("@gx please skip rule X")).toBe(true);
    expect(containsGxMention("@GX override")).toBe(true);
    expect(containsGxMention("no mention here")).toBe(false);
  });
});

describeDb("handleGxMention integration", () => {
  afterAll(async () => {
    const { closeDatabase } = await import("../src/db");
  });

  test("retires matching rules on veto pattern", async () => {
    const { getSql, runMigrations } = await import("../src/db");
    await runMigrations();
    const db = getSql();
    const now = Date.now();

    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${now}) RETURNING id
    `;
    const [event] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id
      ) VALUES (
        ${now}, 'test', 'abc123', '{}'::jsonb, ${org.id}, ${rulesUserId}
      )
      RETURNING id
    `;
    const [bookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
      ) VALUES (
        ${rulesUserId}, 'acme/gx', 'feat/rules', ${now}, ${now}, ${org.id}, ${event.id}
      )
      RETURNING id
    `;
    const [summary] = await db<{ id: string }[]>`
      INSERT INTO summaries (org_id, bookmark_id, content, model, posted_at_ms)
      VALUES (${org.id}, ${bookmark.id}, 'Intent\nTest', 'mock', ${now})
      RETURNING id
    `;
    const [comment] = await db<{ id: string }[]>`
      INSERT INTO pr_comments (org_id, bookmark_id, author, body, is_gx_mention, created_at_ms)
      VALUES (${org.id}, ${bookmark.id}, 'alice', '@gx please skip rule never use var', true, ${now})
      RETURNING id
    `;
    const [rule] = await db<{ id: string }[]>`
      INSERT INTO rules (
        org_id, repo_scope, rule_text, scope_expr, strength, status, source_comment_id, created_at_ms
      ) VALUES (
        ${org.id}, 'acme/gx', 'never use var', 'src/', 'binding', 'inferred', ${comment.id}, ${now}
      )
      RETURNING id
    `;

    const result = await handleGxMention(db, {
      orgId: org.id,
      bookmarkId: bookmark.id,
      commentId: comment.id,
      author: "alice",
      body: "@gx please skip rule never use var",
    });

    expect(result.retiredRuleIds).toContain(rule.id);
    expect(result.reply).toContain("retired");

    const [updated] = await db<{ status: string }[]>`
      SELECT status FROM rules WHERE id = ${rule.id}
    `;
    expect(updated.status).toBe("retired");

    const events = await db<{ kind: string }[]>`
      SELECT kind FROM summary_events WHERE summary_id = ${summary.id}
    `;
    expect(events.some((e) => e.kind === "override")).toBe(true);
  });
});
