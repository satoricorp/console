function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gx-server",
  };
}

export type PostedComment = {
  id: number;
  htmlUrl: string | null;
};

export type PullRequestReviewComment = {
  id: number;
  body: string;
  path: string | null;
  line: number | null;
  inReplyToId: number | null;
  userLogin: string | null;
};

export async function listPullRequestReviewComments(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<PullRequestReviewComment[]> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${pullNumber}/comments?per_page=100`,
    {
      headers: githubHeaders(accessToken),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub list review comments failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  const payload = JSON.parse(text) as Array<{
    id?: number;
    body?: string;
    path?: string;
    line?: number;
    in_reply_to_id?: number;
    user?: { login?: string };
  }>;

  return payload.flatMap((comment) => {
    if (typeof comment.id !== "number") return [];
    return [
      {
        id: comment.id,
        body: comment.body ?? "",
        path: comment.path ?? null,
        line: typeof comment.line === "number" ? comment.line : null,
        inReplyToId:
          typeof comment.in_reply_to_id === "number"
            ? comment.in_reply_to_id
            : null,
        userLogin: comment.user?.login ?? null,
      },
    ];
  });
}

export async function postIssueComment(
  accessToken: string,
  repoFullName: string,
  issueNumber: number,
  body: string,
): Promise<PostedComment> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub post comment failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  const payload = JSON.parse(text) as { id?: number; html_url?: string };
  if (typeof payload.id !== "number") {
    throw new Error("GitHub post comment response missing id");
  }

  return {
    id: payload.id,
    htmlUrl: payload.html_url ?? null,
  };
}

export async function postPullRequestReviewReply(
  accessToken: string,
  repoFullName: string,
  _pullNumber: number,
  body: string,
  inReplyToCommentId: number,
): Promise<PostedComment> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/comments/${inReplyToCommentId}/replies`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub post review reply failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  const payload = JSON.parse(text) as { id?: number; html_url?: string };
  if (typeof payload.id !== "number") {
    throw new Error("GitHub post review reply response missing id");
  }

  return {
    id: payload.id,
    htmlUrl: payload.html_url ?? null,
  };
}
