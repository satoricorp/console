import { isRunMutationCtx } from "@convex-dev/better-auth/utils";
import type { GenericCtx } from "@convex-dev/better-auth";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

function githubLoginFromUser(user: Record<string, unknown>): string {
  const candidates = [user.username, user.displayUsername, user.name];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "unknown";
}

function userIdFromCreatedUser(user: Record<string, unknown>): string | null {
  const id = user.id ?? user._id;
  if (typeof id !== "string" || !id.trim()) {
    return null;
  }
  return id.trim();
}

export async function notifyNewWebSignup(
  authCtx: GenericCtx<DataModel>,
  user: Record<string, unknown>,
): Promise<void> {
  try {
    if (!isRunMutationCtx(authCtx)) {
      return;
    }

    const userId = userIdFromCreatedUser(user);
    if (!userId) {
      return;
    }

    const email = typeof user.email === "string" ? user.email : "";
    const githubLogin = githubLoginFromUser(user);

    await authCtx.runMutation(internal.signupNotify.enqueueSignupNotify, {
      userId,
      email,
      githubLogin,
      source: "web",
    });
  } catch {
    // Signup email must never block auth.
  }
}
