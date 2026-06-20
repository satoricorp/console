"use client";

import { useMemo, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/button";
import { authClient } from "@/lib/auth-client";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

export function ApiKeysManager() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const authReady =
    !sessionPending && !convexAuthLoading && Boolean(session?.user) && isAuthenticated;

  const apiKeys = useQuery(api.apiKeys.listMyApiKeys, authReady ? {} : "skip");
  const createApiKey = useAction(api.apiKeys.createMyApiKey);
  const revokeApiKey = useMutation(api.apiKeys.revokeMyApiKey);

  const [name, setName] = useState("MCP key");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedKeys = useMemo(() => apiKeys ?? [], [apiKeys]);
  const loading = !authReady || apiKeys === undefined;

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const result = await createApiKey({
        name,
      });
      setRevealedKey(result.apiKey);
      setName("MCP key");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create API key",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
  }

  async function handleRevoke(id: Id<"apiKeys">) {
    setRevokingId(id);
    setError(null);
    try {
      await revokeApiKey({ id });
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Failed to revoke API key",
      );
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="space-y-2 text-left">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          API access
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Create an API key
        </h1>
      </div>

      <div className="overflow-hidden border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 bg-zinc-50 px-3 py-2 dark:bg-zinc-900/50">
          <KeyRound className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Key name"
            className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100"
          />
        </div>
      </div>

      {error ? (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {revealedKey ? (
        <div className="overflow-hidden border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="border-b border-emerald-200 px-4 py-3 dark:border-emerald-900">
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
              New API key
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-3">
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-emerald-950 dark:text-emerald-100">
              {revealedKey}
            </code>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-emerald-300 text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900"
              aria-label="Copy API key"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden border border-zinc-200 dark:border-zinc-800">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-12 animate-pulse bg-zinc-100 dark:bg-zinc-900"
              />
            ))}
          </div>
        ) : sortedKeys.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No API keys yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {sortedKeys.map((apiKey) => (
              <li
                key={apiKey.id}
                className="flex min-w-0 items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {apiKey.name}
                  </p>
                  <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {apiKey.keyPrefix}
                  </p>
                </div>
                <div className="hidden text-right text-xs text-zinc-500 dark:text-zinc-400 sm:block">
                  <p>Created {formatDate(apiKey.createdAt)}</p>
                  <p>
                    {apiKey.lastUsedAt
                      ? `Used ${formatDate(apiKey.lastUsedAt)}`
                      : "Never used"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(apiKey.id)}
                  disabled={revokingId === apiKey.id}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  aria-label={`Revoke ${apiKey.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => void handleCreate()}
          disabled={creating || loading}
          className="py-2.5"
        >
          {creating ? "Creating..." : "Create API key"}
        </Button>
      </div>
    </div>
  );
}
