"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/button";
import { pushLabel, type GxPrPushListItem } from "@/lib/gx-pr-payload";
import { PrDebugTray } from "./pr-debug-tray";
import { PrPushPreview } from "./pr-push-preview";

export function PrConsole() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const authReady =
    !sessionPending &&
    !convexAuthLoading &&
    Boolean(session?.user) &&
    isAuthenticated;

  const pushes = useQuery(api.gxPr.listMyPushes, authReady ? {} : "skip");
  const seedDemoPush = useMutation(api.gxPr.seedDemoPush);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);

  const selected = useMemo(() => {
    if (!pushes?.length) return null;
    if (selectedId) {
      return pushes.find((p) => p.id === selectedId) ?? pushes[0];
    }
    return pushes[0];
  }, [pushes, selectedId]);

  if (!authReady || pushes === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Pull requests
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Pushes from <code className="text-xs">gx pr</code> appear here. Select
            one to preview with trees and diffs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void seedDemoPush()}
          >
            Seed demo push
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setTrayOpen(true)}
            disabled={!selected}
          >
            Raw data tray
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
          {pushes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              No PR pushes yet. Run{" "}
              <code className="text-xs">gx pr</code> from a linked repo, or seed a
              demo push to explore the UI.
            </div>
          ) : (
            <ul className="flex flex-col gap-1 overflow-auto">
              {pushes.map((push: GxPrPushListItem) => {
                const active = selected?.id === push.id;
                return (
                  <li key={push.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(push.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
                          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                      }`}
                    >
                      <div className="font-medium text-zinc-900 dark:text-zinc-50">
                        {pushLabel(push)}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {new Date(push.createdAt).toLocaleString()}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <PrPushPreview payload={selected.payload} />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
              Select a push to preview
            </div>
          )}
        </div>
      </div>

      <PrDebugTray
        open={trayOpen}
        onOpenChange={setTrayOpen}
        data={selected?.payload ?? selected ?? null}
      />
    </div>
  );
}
