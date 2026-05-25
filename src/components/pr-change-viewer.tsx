"use client";

import { useMemo, useState } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import { FileTree as FileTreeModel } from "@pierre/trees";
import { FileTree } from "@pierre/trees/react";
import type { Id } from "../../convex/_generated/dataModel";

export type PrAddData = {
  id: Id<"gxAdds">;
  order: number;
  changeId?: string;
  jjChangeId?: string;
  currentCommitId?: string;
  description?: string;
  status?: string;
  branchName?: string;
  baseBranchName?: string;
  githubPullRequestUrl?: string;
  files: string[];
  patch?: string;
  debugJson: string;
};

function allFiles(adds: PrAddData[]) {
  return [...new Set(adds.flatMap((add) => add.files))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function PrChangeViewer({ adds }: { adds: PrAddData[] }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const files = useMemo(() => allFiles(adds), [adds]);
  const selectedAdds = selectedPath
    ? adds.filter((add) => add.files.includes(selectedPath))
    : adds;
  const tree = useMemo(
    () =>
      new FileTreeModel({
        paths: files,
        search: true,
        initialExpansion: 2,
        initialSelectedPaths: selectedPath ? [selectedPath] : [],
        onSelectionChange: (paths) => setSelectedPath(paths[0] ?? null),
      }),
    [files, selectedPath],
  );

  if (adds.length === 0) {
    return (
      <p className="border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        No add snapshots were included in this PR event.
      </p>
    );
  }

  return (
    <div className="grid min-h-[32rem] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="min-h-80 overflow-hidden border border-zinc-200 dark:border-zinc-800">
        {files.length > 0 ? (
          <FileTree
            model={tree}
            className="block h-full min-h-80"
            header={
              <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                Changed files
              </div>
            }
          />
        ) : (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
            No changed files reported.
          </p>
        )}
      </aside>

      <div className="min-w-0 space-y-4">
        {selectedAdds.map((add) => (
          <section key={add.id} className="space-y-2">
            <div className="border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {add.description ?? `Add ${add.order + 1}`}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {add.branchName ? `${add.branchName} · ` : ""}
                {add.files.length} {add.files.length === 1 ? "file" : "files"}
              </p>
            </div>
            {add.patch ? (
              <div className="overflow-hidden border border-zinc-200 dark:border-zinc-800">
                <PatchDiff patch={add.patch} disableWorkerPool />
              </div>
            ) : (
              <pre className="overflow-auto border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                {add.files.join("\n")}
              </pre>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
