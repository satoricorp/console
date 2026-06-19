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
  pullNumber: number,
  body: string,
  inReplyToCommentId: number,
): Promise<PostedComment> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${pullNumber}/comments`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body,
        in_reply_to: inReplyToCommentId,
      }),
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
