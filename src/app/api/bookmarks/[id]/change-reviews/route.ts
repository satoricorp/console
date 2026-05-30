import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import {
  listChangeReviewsForUser,
  upsertChangeReviewForUser,
} from "@/lib/local-postgres";

function parseReviewBody(body: {
  jjChangeId?: string;
  stackIndex?: number;
  approvalPercent?: number;
  notes?: string;
}):
  | { ok: true; review: { jjChangeId: string; stackIndex: number; approvalPercent: number; notes?: string } }
  | { ok: false; error: string } {
  if (typeof body.jjChangeId !== "string" || !body.jjChangeId) {
    return { ok: false, error: "jjChangeId is required" };
  }
  if (!Number.isInteger(body.stackIndex) || (body.stackIndex ?? -1) < 0) {
    return { ok: false, error: "stackIndex must be a non-negative integer" };
  }
  const approvalPercent = Math.round(body.approvalPercent ?? Number.NaN);
  if (
    !Number.isInteger(approvalPercent) ||
    approvalPercent < 0 ||
    approvalPercent > 100
  ) {
    return {
      ok: false,
      error: "approvalPercent must be an integer from 0 to 100",
    };
  }

  return {
    ok: true,
    review: {
      jjChangeId: body.jjChangeId,
      stackIndex: body.stackIndex!,
      approvalPercent,
      notes: body.notes,
    },
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;

  try {
    const reviews = await listChangeReviewsForUser(user._id, bookmarkId);
    return Response.json(reviews);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load change reviews";
    return Response.json({ error: message }, { status: 503 });
  }
}

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

  const parsed = parseReviewBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const saved = await upsertChangeReviewForUser(
      user._id,
      bookmarkId,
      parsed.review,
    );

    await fetchAuthMutation(api.gxChangeReviews.upsertChangeReview, {
      bookmarkId,
      jjChangeId: parsed.review.jjChangeId,
      stackIndex: parsed.review.stackIndex,
      approvalPercent: parsed.review.approvalPercent,
      notes: parsed.review.notes,
    });

    return Response.json(saved);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save change review";
    return Response.json({ error: message }, { status: 503 });
  }
}
