import { v } from "convex/values";
import { mutation } from "./_generated/server";

const EMAIL_MAX_LENGTH = 320;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const join = mutation({
  args: {
    email: v.string(),
  },
  returns: v.object({
    alreadyJoined: v.boolean(),
  }),
  handler: async (ctx, { email }) => {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw new Error("Enter a valid email address");
    }

    const existing = await ctx.db
      .query("waitlistEmails")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();

    if (existing) {
      return { alreadyJoined: true };
    }

    await ctx.db.insert("waitlistEmails", {
      email: normalized,
      createdAt: Date.now(),
    });

    return { alreadyJoined: false };
  },
});
