"use client";

import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";

const posthogEnabled = Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);

type PostHogUser = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  username?: string | null;
  displayUsername?: string | null;
};

function firstPresent(...values: Array<string | null | undefined>) {
  return values.find((value) => value && value.trim())?.trim();
}

export function PostHogIdentifier() {
  const { data: session, isPending } = authClient.useSession();
  const lastDistinctIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!posthogEnabled) return;
    if (isPending) return;

    const user = session?.user as PostHogUser | undefined;
    const distinctId = firstPresent(user?.id, user?.email, user?.username);

    if (!distinctId) {
      if (lastDistinctIdRef.current) {
        posthog.reset();
        lastDistinctIdRef.current = null;
      }
      return;
    }

    if (lastDistinctIdRef.current === distinctId) return;

    posthog.identify(distinctId, {
      email: user?.email ?? undefined,
      name: user?.name ?? undefined,
      username: firstPresent(user?.username, user?.displayUsername),
    });
    lastDistinctIdRef.current = distinctId;
  }, [isPending, session?.user]);

  return null;
}
