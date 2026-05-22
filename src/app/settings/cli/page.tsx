"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";
import { Button } from "@/components/button";

function formatTimestamp(value?: number | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export default function CliSettingsPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const sessions = useQuery(
    api.gxAuth.getMyCliSessions,
    session?.user ? {} : "skip",
  );
  const revokeSession = useMutation(api.gxAuth.revokeMyCliSession);
  const [revokingId, setRevokingId] = useState<Id<"gxCliSessions"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke(sessionId: Id<"gxCliSessions">) {
    setRevokingId(sessionId);
    setError(null);
    try {
      const result = await revokeSession({ sessionId });
      if (!result.revoked) {
        setError("Could not deactivate that device.");
      }
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Could not deactivate that device.",
      );
    } finally {
      setRevokingId(null);
    }
  }

  if (sessionPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-12">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">CLI devices</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in to manage GX CLI sessions.
        </p>
        <AuthButton />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">CLI devices</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Machines signed in with <code className="font-mono">gx auth login</code>.
          Deactivating a device revokes its upload token immediately.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {sessions === undefined ? (
        <div className="h-32 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      ) : sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          No active CLI devices. Run <code className="font-mono">gx auth login</code>{" "}
          from a machine to connect it.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {sessions.map((cliSession) => (
            <li
              key={cliSession.sessionId}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {cliSession.machineName}
                </p>
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  {cliSession.machineId}
                </p>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Last used {formatTimestamp(cliSession.lastUsedAt)} · signed in{" "}
                  {formatTimestamp(cliSession.createdAt)}
                  {cliSession.gxVersion ? ` · gx ${cliSession.gxVersion}` : ""}
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={revokingId === cliSession.sessionId}
                onClick={() => void handleRevoke(cliSession.sessionId)}
              >
                {revokingId === cliSession.sessionId ? "Deactivating…" : "Deactivate"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
