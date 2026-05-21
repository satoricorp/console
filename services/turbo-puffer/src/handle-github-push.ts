import { scheduleIndexRepo } from "./index-repo";
import { verifyGithubWebhookSignature } from "./fetch-github-tree";
import { shouldIndexRepo } from "./notify-convex";

type PushEvent = {
  ref: string;
  after: string;
  repository: {
    full_name: string;
    id: number;
    default_branch?: string;
  };
  installation?: { id: number };
};

export async function handleGithubPush(request: Request): Promise<Response> {
  const payload = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyGithubWebhookSignature(payload, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  if (event !== "push") {
    return new Response("Ignored", { status: 200 });
  }

  let body: PushEvent;
  try {
    body = JSON.parse(payload) as PushEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const fullName = body.repository.full_name;
  const defaultBranch = body.repository.default_branch ?? "main";
  const expectedRef = `refs/heads/${defaultBranch}`;

  if (body.ref !== expectedRef) {
    return new Response("Ignored non-default branch push", { status: 200 });
  }

  if (body.after === "0000000000000000000000000000000000000000") {
    return new Response("Ignored branch deletion", { status: 200 });
  }

  const canIndex = await shouldIndexRepo(fullName);
  if (!canIndex) {
    return new Response("Repo not tracked for indexing", { status: 200 });
  }

  if (body.installation?.id) {
    process.env.GITHUB_APP_INSTALLATION_ID = String(body.installation.id);
  }

  scheduleIndexRepo({
    fullName,
    githubId: body.repository.id,
    commitId: body.after,
    trigger: "merge",
  });

  return new Response(JSON.stringify({ enqueued: true, fullName }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}
