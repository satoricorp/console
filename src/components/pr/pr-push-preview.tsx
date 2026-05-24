"use client";

import { PatchDiff } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { extractPatch, extractPaths } from "@/lib/gx-pr-payload";

type PrPushPreviewProps = {
  payload: unknown;
};

export function PrPushPreview({ payload }: PrPushPreviewProps) {
  const paths = extractPaths(payload);
  const patch = extractPatch(payload);
  const { model: treeModel } = useFileTree({
    paths: paths.length > 0 ? paths : ["(no paths in payload)"],
    density: "compact",
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <section className="flex min-h-48 w-full flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 lg:w-64 lg:shrink-0">
        <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          trees.computer
        </div>
        <FileTree
          model={treeModel}
          className="min-h-0 flex-1 overflow-auto text-sm"
          style={{ height: "100%", minHeight: 240 }}
        />
      </section>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          diffs.com
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {patch ? (
            <PatchDiff
              patch={patch}
              options={{
                theme: "pierre-dark",
                diffStyle: "split",
              }}
            />
          ) : (
            <p className="p-4 text-sm text-zinc-500">
              No patch in payload yet. Push with{" "}
              <code className="text-xs">gx pr</code> and include{" "}
              <code className="text-xs">patch</code> (or{" "}
              <code className="text-xs">diff</code>).
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
