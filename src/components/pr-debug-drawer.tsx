"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PrChangeViewer } from "@/components/pr-change-viewer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function PrDebugDrawer({
  prId,
  open,
  onOpenChange,
}: {
  prId: Id<"gxPullRequests"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const details = useQuery(
    api.gxPullRequests.getMineWithAdds,
    open && prId ? { id: prId } : "skip",
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>PR Debug Data</SheetTitle>
          <SheetDescription>
            Inspect the Convex row, raw `gx pr` payload, and per-add changes.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {details === undefined ? (
            <div className="h-40 animate-pulse border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
          ) : details === null ? (
            <p className="border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              This PR event was not found or is not available for your user.
            </p>
          ) : (
            <div className="space-y-6">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Stored PR
                </h3>
                <pre className="max-h-72 overflow-auto border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  {JSON.stringify(details.pr, null, 2)}
                </pre>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Raw Payload
                </h3>
                <pre className="max-h-72 overflow-auto border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  {details.pr.debugJson}
                </pre>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Add Changes
                </h3>
                <PrChangeViewer adds={details.adds} />
              </section>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
