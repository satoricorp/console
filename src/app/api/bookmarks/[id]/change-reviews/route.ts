import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import { upsertChangeReviewForUser } from "@/lib/local-postgres";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;
  const body = (await request.json()) as {
    jjChangeId?: string;
    stackIndex?: number;
    approvalPercent?: number;
    notes?: string;
  };

  if (typeof body.jjChangeId !== "string" || !body.jjChangeId) {
    return Response.json({ error: "jjChangeId is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.stackIndex) || (body.stackIndex ?? -1) < 0) {
    return Response.json({ error: "stackIndex must be a non-negative integer" }, { status: 400 });
  }
  if (
    !Number.isInteger(body.approvalPercent) ||
    (body.approvalPercent ?? -1) < 0 ||
    (body.approvalPercent ?? 101) > 100
  ) {
    return Response.json(
      { error: "approvalPercent must be an integer from 0 to 100" },
      { status: 400 },
    );
  }

  try {
    const saved = await upsertChangeReviewForUser(user._id, bookmarkId, {
      jjChangeId: body.jjChangeId,
      stackIndex: body.stackIndex!,
      approvalPercent: body.approvalPercent!,
      notes: body.notes,
    });

    await fetchAuthMutation(api.gxChangeReviews.upsertChangeReview, {
      bookmarkId,
      jjChangeId: body.jjChangeId,
      stackIndex: body.stackIndex!,
      approvalPercent: body.approvalPercent!,
      notes: body.notes,
    });

    return Response.json(saved);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save change review";
    return Response.json({ error: message }, { status: 503 });
  }
}
