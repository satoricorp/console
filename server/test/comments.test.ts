import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  listPullRequestReviewComments,
  postPullRequestReviewReply,
} from "../src/github/comments";

describe("GitHub comment helpers", () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fetchCalls.length = 0;
  });

  test("listPullRequestReviewComments uses pulls comments endpoint", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });
      return new Response(
        JSON.stringify([
          {
            id: 42,
            body: "@gx explain this hunk",
            path: "server/src/github/webhook.ts",
            line: 12,
            user: { login: "alice" },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const comments = await listPullRequestReviewComments(
      "token",
      "acme/gx",
      17,
    );

    expect(fetchCalls[0]?.url).toBe(
      "https://api.github.com/repos/acme/gx/pulls/17/comments?per_page=100",
    );
    expect(comments).toEqual([
      {
        id: 42,
        body: "@gx explain this hunk",
        path: "server/src/github/webhook.ts",
        line: 12,
        inReplyToId: null,
        userLogin: "alice",
      },
    ]);
  });

  test("postPullRequestReviewReply uses threaded replies endpoint", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });
      return new Response(
        JSON.stringify({
          id: 9002,
          html_url: "https://github.com/acme/gx/pull/17#discussion_r9002",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const posted = await postPullRequestReviewReply(
      "token",
      "acme/gx",
      17,
      "GX: threaded reply",
      55501,
    );

    expect(fetchCalls[0]?.url).toBe(
      "https://api.github.com/repos/acme/gx/pulls/comments/55501/replies",
    );
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      body: "GX: threaded reply",
    });
    expect(posted.id).toBe(9002);
  });
});
