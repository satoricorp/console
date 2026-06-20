"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/button";
import { GitHubIcon } from "@/components/github-icon";
import { OrgMultiSelect } from "@/components/onboarding/org-multi-select";
import { RepoVisibilityIcon } from "@/components/onboarding/repo-icons";

type AvailableRepo = {
  githubId: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch?: string;
};

export function ConnectReposStep() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const listAvailableRepos = useAction(api.repoActions.listAvailableRepos);
  const connectRepos = useAction(api.repoActions.connectRepos);
  const connectedRepos = useQuery(
    api.repos.getMyConnectedRepos,
    session?.user && isAuthenticated ? {} : "skip",
  );
  const authReady =
    !sessionPending && !convexAuthLoading && Boolean(session?.user) && isAuthenticated;

  const [availableRepos, setAvailableRepos] = useState<AvailableRepo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState<Set<string>>(() => new Set());

  const connectedFullNames = useMemo(
    () => new Set(connectedRepos?.map((repo) => repo.fullName) ?? []),
    [connectedRepos],
  );

  useEffect(() => {
    if (!authReady) {
      return;
    }

    let cancelled = false;

    async function loadRepos() {
      setLoading(true);
      setError(null);
      try {
        const repos = await listAvailableRepos();
        if (cancelled) return;
        setAvailableRepos(repos);
        setSelected(
          new Set(
            repos
              .filter((repo) => connectedFullNames.has(repo.fullName))
              .map((repo) => repo.fullName),
          ),
        );
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load repositories",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRepos();
    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    sessionPending,
    convexAuthLoading,
    session?.user,
    isAuthenticated,
    listAvailableRepos,
    connectedFullNames,
  ]);

  const orgs = useMemo(() => {
    const owners = new Set(availableRepos.map((repo) => repo.owner));
    return [...owners].sort((a, b) => a.localeCompare(b));
  }, [availableRepos]);

  const filteredRepos = useMemo(() => {
    const query = search.trim().toLowerCase();
    return availableRepos.filter((repo) => {
      if (orgFilter.size > 0 && !orgFilter.has(repo.owner)) return false;
      if (!query) return true;
      return repo.fullName.toLowerCase().includes(query);
    });
  }, [availableRepos, search, orgFilter]);

  const selectedCount = selected.size;
  const newlySelectedCount = [...selected].filter(
    (fullName) => !connectedFullNames.has(fullName),
  ).length;

  function toggleRepo(fullName: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else {
        next.add(fullName);
      }
      return next;
    });
  }

  async function handleConnect() {
    const reposToConnect = availableRepos.filter(
      (repo) =>
        selected.has(repo.fullName) && !connectedFullNames.has(repo.fullName),
    );

    if (reposToConnect.length === 0) return;

    setConnecting(true);
    setError(null);
    try {
      await connectRepos({ repos: reposToConnect });
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to connect repositories",
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="space-y-2 text-left">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Step 1 of onboarding
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Connect your GitHub repositories
        </h1>
      </div>

      <div className="overflow-hidden border border-zinc-200 dark:border-zinc-800">
        {!loading && orgs.length > 1 ? (
          <div className="border-b border-zinc-200 dark:border-zinc-800">
            <OrgMultiSelect
              orgs={orgs}
              selected={orgFilter}
              onChange={setOrgFilter}
            />
          </div>
        ) : null}
        <div className="flex items-center gap-2 bg-zinc-50 px-3 py-2 dark:bg-zinc-900/50">
          <GitHubIcon className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search repositories"
            className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100"
          />
        </div>
      </div>

      {error ? (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden border border-zinc-200 dark:border-zinc-800">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-12 animate-pulse bg-zinc-100 dark:bg-zinc-900"
              />
            ))}
          </div>
        ) : filteredRepos.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            {search || orgFilter.size > 0
              ? "No repositories match your filters."
              : "No repositories found on your GitHub account."}
          </p>
        ) : (
          <ul className="max-h-[28rem] divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
            {filteredRepos.map((repo) => {
              const isConnected = connectedFullNames.has(repo.fullName);
              const isSelected = selected.has(repo.fullName);

              return (
                <li key={repo.fullName}>
                  <button
                    type="button"
                    disabled={isConnected}
                    aria-pressed={isSelected}
                    onClick={() => toggleRepo(repo.fullName)}
                    className={`flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left transition-colors ${
                      isConnected
                        ? "cursor-default opacity-70"
                        : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    } ${
                      isSelected && !isConnected
                        ? "bg-zinc-100 dark:bg-zinc-900"
                        : ""
                    }`}
                  >
                    <p className="min-w-0 flex-1 truncate text-sm">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {repo.owner}
                      </span>
                      <span className="text-zinc-300 dark:text-zinc-600">
                        {" "}
                        /{" "}
                      </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {repo.name}
                      </span>
                    </p>
                    <RepoVisibilityIcon isPrivate={repo.private} />
                    {isConnected ? (
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        Connected
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {selectedCount === 0
            ? "Select at least one repository to continue."
            : `${selectedCount} selected${connectedFullNames.size > 0 ? ` · ${connectedFullNames.size} already connected` : ""}`}
        </p>
        <Button
          onClick={() => void handleConnect()}
          disabled={connecting || newlySelectedCount === 0}
          className="py-2.5"
        >
          {connecting
            ? "Connecting..."
            : newlySelectedCount === 0
              ? "Connect repositories"
              : `Connect ${newlySelectedCount} ${newlySelectedCount === 1 ? "repository" : "repositories"}`}
        </Button>
      </div>
    </div>
  );
}
