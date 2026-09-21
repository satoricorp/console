"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const DEFAULT_NOTIFY_TO = "jlachance1@gmail.com";

async function sendResendEmail(args: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("Resend signup notify failed", {
        status: response.status,
        body: body.slice(0, 500),
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("Resend signup notify error", error);
    return false;
  }
}

export const sendSignupEmail = internalAction({
  args: {
    notificationId: v.id("signupNotifications"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.signupNotify.getSignupNotification, {
      notificationId: args.notificationId,
    });
    if (!row || row.status === "sent") {
      return null;
    }

    const notifyTo =
      process.env.GX_SIGNUP_NOTIFY_EMAIL?.trim() || DEFAULT_NOTIFY_TO;
    const from = process.env.NOTIFY_FROM_EMAIL?.trim();
    if (!from) {
      await ctx.runMutation(internal.signupNotify.markSignupNotificationFailed, {
        notificationId: args.notificationId,
      });
      return null;
    }

    const subject = `GX signup: ${row.githubLogin}`;
    const text = [
      "New GX signup",
      "",
      `GitHub: ${row.githubLogin}`,
      `Email: ${row.email}`,
      `Source: ${row.source}`,
      `User id: ${row.userId}`,
    ].join("\n");

    const sent = await sendResendEmail({
      from,
      to: notifyTo,
      subject,
      text,
    });

    if (sent) {
      await ctx.runMutation(internal.signupNotify.markSignupNotificationSent, {
        notificationId: args.notificationId,
      });
    } else {
      await ctx.runMutation(internal.signupNotify.markSignupNotificationFailed, {
        notificationId: args.notificationId,
      });
    }

    return null;
  },
});
